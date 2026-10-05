import { amount, calculate, changePeriod, money, parseAmount, searchKey } from "./core.mjs";
import { messages } from "./i18n.mjs";
import { flagFor } from "./flags.mjs";

const $ = id => document.getElementById(id);
let language = navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
try { language = ["pt", "en"].includes(localStorage.getItem("language")) ? localStorage.getItem("language") : language; } catch { /* Storage is optional. */ }
const state = { source: "USD", target: "BRL", period: "annual", targetPeriod: "monthly", editedSide: "source", sourcePayments: 12, targetPayments: 12, hoursPerWeek: 40, value: null, mode: "auto", manual: null, quote: null, expires: 0, loading: false, error: false };
let currencies = [{ code: "BRL", name: "Brazilian Real" }, { code: "USD", name: "US Dollar" }];
let catalogueFailed = false;
let requestNumber = 0;
let rateController;
let announcementTimer;
let openSide = null;
let activeOption = -1;
let visibleCurrencies = [];
let displayNames;
let currencyNames = new Map();
const locale = () => language === "pt" ? "pt-BR" : "en-US";
const t = key => messages[language][key];
const currencyName = code => currencyNames.get(code) || code;
const activeRate = () => state.source === state.target ? 1 : state.mode === "manual" ? state.manual : state.quote?.rate ?? null;
const salaryField = side => $(side === "source" ? "salary" : "target-salary");
const periodFor = side => side === "source" ? state.period : state.targetPeriod;

function rebuildNames() {
  displayNames = new Intl.DisplayNames([locale()], { type: "currency" });
  currencyNames = new Map(currencies.map(({ code, name }) => {
    const translated = displayNames.of(code);
    return [code, translated && translated !== code ? translated : name];
  }));
}

function showError(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function setLanguage() {
  if (state.value === null && salaryField(state.editedSide).value.trim()) state.value = parseAmount(salaryField(state.editedSide).value, locale());
  document.documentElement.lang = locale();
  document.title = `tiny salary · ${t("tagline")}`;
  $("language").value = language;
  document.querySelectorAll("[data-i18n]").forEach(element => { element.textContent = t(element.dataset.i18n); });
  $("period-control").setAttribute("aria-label", t("salaryPeriod"));
  $("target-period-control").setAttribute("aria-label", t("targetPeriod"));
  $("mode-control").setAttribute("aria-label", t("rateMode"));
  rebuildNames();
  for (const side of ["source", "target"]) {
    $(`${side}-search`).placeholder = t("search");
    $(`${side}-search`).setAttribute("aria-label", `${t(side === "source" ? "sourceCurrency" : "targetCurrency")}: ${t("search")}`);
    renderCurrency(side);
  }
  if (state.value !== null) salaryField(state.editedSide).value = amount(state.value, state[state.editedSide], locale());
  if (state.hoursPerWeek !== null) $("hours-per-week").value = formatRate(state.hoursPerWeek);
  if (state.manual !== null) $("manual-rate").value = formatRate(state.manual);
  render();
}

function renderCurrency(side) {
  const code = state[side];
  $(`${side}-flag`).src = flagFor(code);
  $(`${side}-selection`).querySelector("strong").textContent = code;
  $(`${side}-name`).textContent = currencyName(code);
}

function formatRate(value) {
  return new Intl.NumberFormat(locale(), { maximumSignificantDigits: 12 }).format(value);
}

function render() {
  const rate = activeRate();
  const side = state.editedSide;
  const otherSide = side === "source" ? "target" : "source";
  const own = calculate(state.value, periodFor(side), state[`${side}Payments`], state[`${side}Payments`], 1, state.hoursPerWeek);
  const converted = rate > 0 ? calculate(state.value, periodFor(side), state[`${side}Payments`], state[`${otherSide}Payments`], side === "source" ? rate : 1 / rate, state.hoursPerWeek) : null;
  const source = side === "source" ? own : converted;
  const target = side === "target" ? own : converted;
  $("input-code").textContent = state.source;
  $("result-code").textContent = state.target;
  const values = { source, target };
  for (const current of ["source", "target"]) {
    if (current !== side) {
      const data = values[current];
      const value = data?.[periodFor(current)];
      salaryField(current).value = value === undefined ? "" : amount(value, state[current], locale());
    }
  }
  const targetOther = state.targetPeriod === "annual" ? target?.monthly : target?.annual;
  $("target-equivalent").textContent = `${targetOther !== undefined ? money(targetOther, state.target, locale()) : "—"} ${t(state.targetPeriod === "annual" ? "perMonth" : "perYear")}`;
  $("hourly-result").textContent = `${target ? money(target.hourly, state.target, locale()) : "—"} ${t("perHour")}`;
  $("hourly-result").hidden = state.targetPeriod === "hourly";
  const other = state.period === "annual" ? source?.monthly : source?.annual;
  $("source-equivalent").textContent = `${other !== undefined ? money(other, state.source, locale()) : "—"} ${t(state.period === "annual" ? "perMonth" : "perYear")}`;
  for (const current of ["source", "target"]) {
    $(`${current}-payments`).textContent = t(periodFor(current) === "hourly" ? "hourlyNoThirteenth" : state[`${current}Payments`] === 13 ? "payments13" : "payments12");
    $(`${current}-thirteenth`).disabled = periodFor(current) === "hourly";
  }
  for (const current of ["source", "target"]) {
    $(`${current === "source" ? "period" : "target-period"}-control`).querySelectorAll("[data-period]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.period === periodFor(current)));
      button.disabled = state.hoursPerWeek === null && button.dataset.period !== periodFor(current);
    });
  }
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    button.disabled = state.source === state.target;
  });
  const invalidSalary = salaryField(side).value.trim() !== "" && state.value === null;
  const tooLarge = state.hoursPerWeek !== null && state.value !== null && (!own || (rate > 0 && !converted));
  for (const current of ["source", "target"]) {
    const invalid = current === side && (invalidSalary || tooLarge);
    showError(current === "source" ? "salary-error" : "target-error", invalid ? t(invalidSalary ? "invalidAmount" : "tooLarge") : "");
    salaryField(current).setAttribute("aria-invalid", String(invalid));
  }
  const invalidHours = state.hoursPerWeek === null;
  showError("hours-error", invalidHours ? t("invalidHours") : "");
  $("hours-per-week").setAttribute("aria-invalid", String(invalidHours));
  $("manual-field").hidden = state.mode !== "manual" || state.source === state.target;
  const invalidManual = state.mode === "manual" && $("manual-rate").value.trim() !== "" && !(state.manual > 0);
  showError("manual-error", invalidManual ? t("invalidRate") : "");
  $("manual-rate").setAttribute("aria-invalid", String(invalidManual));
  $("manual-label").textContent = `${state.target} ${t("perOne")} ${state.source}`;
  $("rate-display").textContent = rate > 0 ? `1 ${state.source} = ${formatRate(rate)} ${state.target}` : `${state.source} → ${state.target}`;
  let detail;
  if (state.source === state.target) detail = t("sameCurrency");
  else if (state.mode === "manual") detail = t("manualDetail");
  else if (state.loading) detail = t("loading");
  else if (state.error) detail = t("rateUnavailable");
  else if (state.quote?.date) {
    const reference = new Date(`${state.quote.date}T12:00:00Z`).toLocaleDateString(locale(), { timeZone: "UTC" });
    detail = `${t("reference")} ${reference}${state.quote.stale ? ` · ${t("stale")}` : ""}`;
  } else detail = t("loading");
  $("rate-detail").textContent = detail;
  $("rate-detail").classList.toggle("error", state.mode === "auto" && state.error);
  $("retry-rate").hidden = state.mode !== "auto" || !(state.error || state.quote?.stale) || state.loading;
  $("catalogue-error").hidden = !catalogueFailed;
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => {
    const result = values[otherSide];
    $("announcement").textContent = result
      ? `${t("resultAnnouncement")}: ${money(result[periodFor(otherSide)], state[otherSide], locale())} ${t(periodFor(otherSide) === "hourly" ? "perHour" : periodFor(otherSide) === "monthly" ? "perMonth" : "perYear")}.`
      : t(state.value === null && !invalidSalary ? "emptyResult" : "unavailableResult");
  }, 650);
}

async function fetchRate(force = false) {
  rateController?.abort();
  const current = ++requestNumber;
  if (state.mode !== "auto") return;
  if (state.source === state.target) { state.quote = null; state.loading = false; state.error = false; render(); return; }
  if (!force && state.quote?.base === state.source && state.quote?.quote === state.target && Date.now() < state.expires) { render(); return; }
  const base = state.source, quote = state.target;
  state.quote = null;
  state.error = false;
  state.loading = true;
  render();
  const controller = new AbortController();
  rateController = controller;
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`/api/rate?${new URLSearchParams({ base, quote })}`, { signal: controller.signal });
    if (!response.ok) throw new Error("rate_unavailable");
    const data = await response.json();
    if (data.base !== base || data.quote !== quote || !Number.isFinite(data.rate) || data.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(data.max_age)) throw new Error("invalid_rate");
    if (current !== requestNumber) return;
    state.quote = data;
    state.expires = Date.now() + data.max_age * 1000;
  } catch {
    if (current !== requestNumber) return;
    state.error = true;
  } finally {
    clearTimeout(timeout);
    if (current === requestNumber) { state.loading = false; render(); }
  }
}

async function fetchCurrencies() {
  $("retry-currencies").disabled = true;
  try {
    const response = await fetch("/api/currencies", { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("catalogue_unavailable");
    const data = await response.json();
    if (!Array.isArray(data.currencies) || !data.currencies.length || data.currencies.some(item => !/^[A-Z]{3}$/.test(item.code) || typeof item.name !== "string")) throw new Error("invalid_catalogue");
    currencies = data.currencies.sort((a, b) => a.code.localeCompare(b.code));
    catalogueFailed = false;
    rebuildNames();
    renderCurrency("source");
    renderCurrency("target");
    if (openSide) filterCurrencies();
  } catch { catalogueFailed = true; }
  finally { $("retry-currencies").disabled = false; render(); }
}

function closeMenu(restoreFocus = false) {
  if (!openSide) return;
  const side = openSide;
  $(`${side}-menu`).hidden = true;
  $(`${side}-currency`).setAttribute("aria-expanded", "false");
  $(`${side}-search`).setAttribute("aria-expanded", "false");
  $(`${side}-search`).removeAttribute("aria-activedescendant");
  openSide = null;
  if (restoreFocus) $(`${side}-currency`).focus();
}

function highlightOption(index, scroll = false) {
  if (!openSide) return;
  const options = [...$(`${openSide}-options`).children];
  activeOption = options.length ? (index + options.length) % options.length : -1;
  options.forEach((option, i) => option.classList.toggle("active", i === activeOption));
  if (activeOption < 0) $(`${openSide}-search`).removeAttribute("aria-activedescendant");
  else {
    const option = options[activeOption];
    $(`${openSide}-search`).setAttribute("aria-activedescendant", option.id);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  }
}

function filterCurrencies() {
  const query = searchKey($(`${openSide}-search`).value);
  visibleCurrencies = currencies.filter(item => searchKey(`${item.code} ${currencyName(item.code)} ${item.name}`).includes(query));
  const options = $(`${openSide}-options`);
  const fragment = document.createDocumentFragment();
  visibleCurrencies.forEach(({ code }, index) => {
    const option = document.createElement("div");
    option.className = "currency-option";
    option.id = `${openSide}-option-${code}`;
    option.dataset.index = index;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(code === state[openSide]));
    const flag = document.createElement("img");
    flag.src = flagFor(code); flag.alt = ""; flag.loading = "lazy"; flag.width = 24; flag.height = 18;
    const codeElement = document.createElement("span");
    codeElement.className = "code"; codeElement.textContent = code;
    const name = document.createElement("span");
    name.className = "name"; name.textContent = currencyName(code);
    option.append(flag, codeElement, name);
    fragment.append(option);
  });
  options.replaceChildren(fragment);
  $(`${openSide}-menu`).querySelector(".empty-search").hidden = visibleCurrencies.length > 0;
  const selected = visibleCurrencies.findIndex(item => item.code === state[openSide]);
  highlightOption(Math.max(0, selected));
}

function selectCurrency(index) {
  const selected = visibleCurrencies[index];
  if (!selected || !openSide) return;
  const side = openSide;
  const changed = state[side] !== selected.code;
  state[side] = selected.code;
  closeMenu(true);
  renderCurrency(side);
  if (!changed) return;
  state.mode = "auto";
  state.manual = null;
  $("manual-rate").value = "";
  if (state.value !== null) salaryField(state.editedSide).value = amount(state.value, state[state.editedSide], locale());
  fetchRate();
}

for (const side of ["source", "target"]) {
  $(`${side}-currency`).addEventListener("click", () => {
    if (openSide === side) { closeMenu(); return; }
    closeMenu(); openSide = side;
    $(`${side}-menu`).hidden = false;
    $(`${side}-currency`).setAttribute("aria-expanded", "true");
    $(`${side}-search`).setAttribute("aria-expanded", "true");
    $(`${side}-search`).value = "";
    filterCurrencies(); $(`${side}-search`).focus();
  });
  $(`${side}-search`).addEventListener("input", filterCurrencies);
  $(`${side}-search`).addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); highlightOption(activeOption + (event.key === "ArrowDown" ? 1 : -1), true); }
    else if (event.key === "Enter") { event.preventDefault(); selectCurrency(activeOption); }
    else if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
  });
  $(`${side}-options`).addEventListener("click", event => {
    const option = event.target.closest("[data-index]");
    if (option) selectCurrency(Number(option.dataset.index));
  });
  $(`${side}-thirteenth`).addEventListener("change", event => { state[`${side}Payments`] = event.target.checked ? 13 : 12; render(); });
}

document.addEventListener("pointerdown", event => { if (openSide && !event.target.closest(`[data-side="${openSide}"]`)) closeMenu(); });
document.addEventListener("focusin", event => { if (openSide && !event.target.closest(`[data-side="${openSide}"]`)) closeMenu(); });
for (const side of ["source", "target"]) {
  salaryField(side).addEventListener("input", event => { state.editedSide = side; state.value = parseAmount(event.target.value, locale()); render(); });
  salaryField(side).addEventListener("blur", () => { if (state.editedSide === side && state.value !== null) salaryField(side).value = amount(state.value, state[side], locale()); });
}
$("hours-per-week").addEventListener("input", event => {
  const value = parseAmount(event.target.value, locale());
  state.hoursPerWeek = value > 0 && value * 52 <= Number.MAX_SAFE_INTEGER ? value : null;
  render();
});
$("hours-per-week").addEventListener("blur", () => { if (state.hoursPerWeek !== null) $("hours-per-week").value = formatRate(state.hoursPerWeek); });
$("manual-rate").addEventListener("input", event => { const value = parseAmount(event.target.value, locale()); state.manual = value > 0 ? value : null; render(); });
$("manual-rate").addEventListener("blur", () => { if (state.manual !== null) $("manual-rate").value = formatRate(state.manual); });
for (const side of ["source", "target"]) {
  $(`${side === "source" ? "period" : "target-period"}-control`).querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
    if (state.hoursPerWeek === null) return;
    const previous = periodFor(side);
    if (side === state.editedSide) {
      const converted = changePeriod(state.value, previous, button.dataset.period, state[`${side}Payments`], state.hoursPerWeek);
      if (state.value !== null && converted === null) return;
      state.value = converted;
      if (state.value !== null) salaryField(side).value = amount(state.value, state[side], locale());
    }
    state[side === "source" ? "period" : "targetPeriod"] = button.dataset.period;
    render();
  }));
}
document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
  if (state.mode === button.dataset.mode) return;
  state.mode = button.dataset.mode;
  if (state.mode === "manual") {
    rateController?.abort(); ++requestNumber; state.loading = false;
    state.manual = state.quote?.rate ?? null;
    $("manual-rate").value = state.manual === null ? "" : formatRate(state.manual);
    render(); $("manual-rate").focus();
  } else fetchRate();
}));
$("language").addEventListener("change", event => {
  language = event.target.value;
  try { localStorage.setItem("language", language); } catch { /* Calculation never depends on storage. */ }
  closeMenu(); setLanguage();
});
$("retry-rate").addEventListener("click", () => fetchRate(true));
$("retry-currencies").addEventListener("click", fetchCurrencies);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.mode === "auto" && Date.now() >= state.expires) fetchRate(); });
window.addEventListener("focus", () => { if (state.mode === "auto" && Date.now() >= state.expires) fetchRate(); });
setLanguage();
fetchCurrencies();
fetchRate();
