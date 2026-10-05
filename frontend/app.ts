import { amount, calculate, changePeriod, formatSalaryText, money, parseAmount, searchKey, type Payments, type Period, type Side } from "./core";
import { messages, type Language, type MessageKey } from "./i18n";
import { flagFor } from "./flags";
import { currenciesResponseSchema, rateSchema, type Currency, type Rate } from "./contracts";
import { mountCompare } from "./compare";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}
function required<T extends Element>(element: T | null): T {
  if (!element) throw new Error("Missing expected element");
  return element;
}
const isPeriod = (value: string | undefined): value is Period => value === "hourly" || value === "monthly" || value === "annual";
let language: Language = navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
try { const stored = localStorage.getItem("language"); if (stored === "pt" || stored === "en") language = stored; } catch { /* Storage is optional. */ }
type State = { source: string; target: string; period: Period; targetPeriod: Period; editedSide: Side; sourcePayments: Payments; targetPayments: Payments; hoursPerWeek: number | null; value: number | null; mode: "auto" | "manual"; manual: number | null; quote: Rate | null; expires: number; loading: boolean; error: boolean };
const state: State = { source: "USD", target: "BRL", period: "annual", targetPeriod: "monthly", editedSide: "source", sourcePayments: 12, targetPayments: 12, hoursPerWeek: 40, value: null, mode: "auto", manual: null, quote: null, expires: 0, loading: false, error: false };
let currencies: Currency[] = [{ code: "BRL", name: "Brazilian Real" }, { code: "USD", name: "US Dollar" }];
let catalogueFailed = false;
let requestNumber = 0;
let rateController: AbortController | undefined;
let announcementTimer: ReturnType<typeof setTimeout> | undefined;
let openSide: Side | null = null;
let activeOption = -1;
let visibleCurrencies: Currency[] = [];
let displayNames: Intl.DisplayNames;
let currencyNames = new Map<string, string>();
let compare: ReturnType<typeof mountCompare> | undefined;
let brazil: { setLanguage: () => void; refreshCurrencies: () => void; activate: () => void } | undefined;
let brazilLoading = false;
const locale = (): string => language === "pt" ? "pt-BR" : "en-US";
const t = (key: MessageKey): string => messages[language][key];
const currencyName = (code: string): string => currencyNames.get(code) || code;
const activeRate = () => state.source === state.target ? 1 : state.mode === "manual" ? state.manual : state.quote?.rate ?? null;
const salaryField = (side: Side): HTMLInputElement => $<HTMLInputElement>(side === "source" ? "salary" : "target-salary");
const periodFor = (side: Side): Period => side === "source" ? state.period : state.targetPeriod;

function rebuildNames() {
  displayNames = new Intl.DisplayNames([locale()], { type: "currency" });
  currencyNames = new Map(currencies.map(({ code, name }) => {
    const translated = displayNames.of(code);
    return [code, translated && translated !== code ? translated : name];
  }));
}

function showError(id: string, text: string): void {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function setLanguage(): void {
  if (state.value === null && salaryField(state.editedSide).value.trim()) state.value = parseAmount(salaryField(state.editedSide).value, locale());
  document.documentElement.lang = locale();
  document.title = `tiny salary · ${t("tagline")}`;
  $<HTMLSelectElement>("language").value = language;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(element => {
    const key = element.dataset.i18n;
    if (key && key in messages.en) element.textContent = t(key as MessageKey);
  });
  $("period-control").setAttribute("aria-label", t("salaryPeriod"));
  $("target-period-control").setAttribute("aria-label", t("targetPeriod"));
  $("mode-control").setAttribute("aria-label", t("rateMode"));
  $("calculator-tabs").setAttribute("aria-label", t("calculatorTabs"));
  rebuildNames();
  for (const side of ["source", "target"] as const) {
    $<HTMLInputElement>(`${side}-search`).placeholder = t("search");
    $(`${side}-search`).setAttribute("aria-label", `${t(side === "source" ? "sourceCurrency" : "targetCurrency")}: ${t("search")}`);
    renderCurrency(side);
  }
  if (state.value !== null) salaryField(state.editedSide).value = amount(state.value, state[state.editedSide], locale());
  if (state.hoursPerWeek !== null) $<HTMLInputElement>("hours-per-week").value = formatRate(state.hoursPerWeek);
  if (state.manual !== null) $<HTMLInputElement>("manual-rate").value = formatRate(state.manual);
  compare?.setLanguage();
  brazil?.setLanguage();
  render();
}

function renderCurrency(side: Side): void {
  const code = state[side];
  $<HTMLImageElement>(`${side}-flag`).src = flagFor(code);
  required($(`${side}-selection`).querySelector("strong")).textContent = code;
  $(`${side}-name`).textContent = currencyName(code);
}

function formatRate(value: number): string {
  return new Intl.NumberFormat(locale(), { maximumSignificantDigits: 12 }).format(value);
}

function formatSalaryInput(field: HTMLInputElement): number | null {
  const result = formatSalaryText(field.value, field.selectionStart ?? field.value.length, locale());
  if (!result) return null;
  if (result.text !== field.value) {
    field.value = result.text;
    field.setSelectionRange(result.cursor, result.cursor);
  }
  return result.value;
}

function render(): void {
  const rate = activeRate();
  const side = state.editedSide;
  const otherSide = side === "source" ? "target" : "source";
  const own = calculate(state.value, periodFor(side), state[`${side}Payments`], state[`${side}Payments`], 1, state.hoursPerWeek);
  const converted = rate !== null && rate > 0 ? calculate(state.value, periodFor(side), state[`${side}Payments`], state[`${otherSide}Payments`], side === "source" ? rate : 1 / rate, state.hoursPerWeek) : null;
  const source = side === "source" ? own : converted;
  const target = side === "target" ? own : converted;
  $("input-code").textContent = state.source;
  $("result-code").textContent = state.target;
  const values = { source, target };
  for (const current of ["source", "target"] as const) {
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
  for (const current of ["source", "target"] as const) {
    $(`${current}-payments`).textContent = t(periodFor(current) === "hourly" ? "hourlyNoThirteenth" : state[`${current}Payments`] === 13 ? "payments13" : "payments12");
    $<HTMLInputElement>(`${current}-thirteenth`).disabled = periodFor(current) === "hourly";
  }
  for (const current of ["source", "target"] as const) {
    $(`${current === "source" ? "period" : "target-period"}-control`).querySelectorAll<HTMLButtonElement>("[data-period]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.period === periodFor(current)));
      button.disabled = state.hoursPerWeek === null && button.dataset.period !== periodFor(current);
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    button.disabled = state.source === state.target;
  });
  const invalidSalary = salaryField(side).value.trim() !== "" && state.value === null;
  const tooLarge = state.hoursPerWeek !== null && state.value !== null && (!own || (rate !== null && rate > 0 && !converted));
  for (const current of ["source", "target"] as const) {
    const invalid = current === side && (invalidSalary || tooLarge);
    showError(current === "source" ? "salary-error" : "target-error", invalid ? t(invalidSalary ? "invalidAmount" : "tooLarge") : "");
    salaryField(current).setAttribute("aria-invalid", String(invalid));
  }
  const invalidHours = state.hoursPerWeek === null;
  showError("hours-error", invalidHours ? t("invalidHours") : "");
  $("hours-per-week").setAttribute("aria-invalid", String(invalidHours));
  $("manual-field").hidden = state.mode !== "manual" || state.source === state.target;
  const invalidManual = state.mode === "manual" && $<HTMLInputElement>("manual-rate").value.trim() !== "" && !(state.manual !== null && state.manual > 0);
  showError("manual-error", invalidManual ? t("invalidRate") : "");
  $("manual-rate").setAttribute("aria-invalid", String(invalidManual));
  $("manual-label").textContent = `${state.target} ${t("perOne")} ${state.source}`;
  $("rate-display").textContent = rate !== null && rate > 0 ? `1 ${state.source} = ${formatRate(rate)} ${state.target}` : `${state.source} → ${state.target}`;
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
    const parsed = rateSchema.safeParse(await response.json() as unknown);
    if (!parsed.success || parsed.data.base !== base || parsed.data.quote !== quote) throw new Error("invalid_rate");
    const data = parsed.data;
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
  $<HTMLButtonElement>("retry-currencies").disabled = true;
  try {
    const response = await fetch("/api/currencies", { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("catalogue_unavailable");
    const parsed = currenciesResponseSchema.safeParse(await response.json() as unknown);
    if (!parsed.success) throw new Error("invalid_catalogue");
    currencies = parsed.data.currencies.sort((a, b) => a.code.localeCompare(b.code));
    catalogueFailed = false;
    rebuildNames();
    renderCurrency("source");
    renderCurrency("target");
    compare?.refreshCurrencies();
    brazil?.refreshCurrencies();
    if (openSide) filterCurrencies();
  } catch { catalogueFailed = true; }
  finally { $<HTMLButtonElement>("retry-currencies").disabled = false; render(); }
}

function closeMenu(restoreFocus = false): void {
  if (!openSide) return;
  const side = openSide;
  $(`${side}-menu`).hidden = true;
  $(`${side}-currency`).setAttribute("aria-expanded", "false");
  $(`${side}-search`).setAttribute("aria-expanded", "false");
  $(`${side}-search`).removeAttribute("aria-activedescendant");
  openSide = null;
  if (restoreFocus) $(`${side}-currency`).focus();
}

function highlightOption(index: number, scroll = false): void {
  if (!openSide) return;
  const options = [...$(`${openSide}-options`).children];
  activeOption = options.length ? (index + options.length) % options.length : -1;
  options.forEach((option, i) => option.classList.toggle("active", i === activeOption));
  if (activeOption < 0) $(`${openSide}-search`).removeAttribute("aria-activedescendant");
  else {
    const option = options[activeOption];
    if (!option) return;
    $(`${openSide}-search`).setAttribute("aria-activedescendant", option.id);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  }
}

function filterCurrencies(): void {
  if (!openSide) return;
  const side = openSide;
  const query = searchKey($<HTMLInputElement>(`${side}-search`).value);
  visibleCurrencies = currencies.filter(item => searchKey(`${item.code} ${currencyName(item.code)} ${item.name}`).includes(query));
  const options = $(`${side}-options`);
  const fragment = document.createDocumentFragment();
  visibleCurrencies.forEach(({ code }, index) => {
    const option = document.createElement("div");
    option.className = "currency-option";
    option.id = `${side}-option-${code}`;
    option.dataset.index = String(index);
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(code === state[side]));
    const flag = document.createElement("img");
    flag.src = flagFor(code); flag.alt = ""; flag.loading = "lazy"; flag.width = 24; flag.height = 18;
    const codeElement = document.createElement("span");
    codeElement.className = "code"; codeElement.textContent = code;
    const name = document.createElement("span");
    name.className = "name"; name.textContent = currencyName(code);
    option.append(flag, codeElement, name);
    if (code === state[side]) {
      const check = document.createElement("i");
      check.className = "ph ph-check selected-icon";
      check.setAttribute("aria-hidden", "true");
      option.append(check);
    }
    fragment.append(option);
  });
  options.replaceChildren(fragment);
  required($(`${side}-menu`).querySelector<HTMLElement>(".empty-search")).hidden = visibleCurrencies.length > 0;
  const selected = visibleCurrencies.findIndex(item => item.code === state[side]);
  highlightOption(Math.max(0, selected));
}

function selectCurrency(index: number): void {
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
  $<HTMLInputElement>("manual-rate").value = "";
  if (state.value !== null) salaryField(state.editedSide).value = amount(state.value, state[state.editedSide], locale());
  fetchRate();
}

$("swap-currencies").addEventListener("click", () => {
  closeMenu();
  [state.source, state.target] = [state.target, state.source];
  renderCurrency("source");
  renderCurrency("target");
  if (state.value !== null) salaryField(state.editedSide).value = amount(state.value, state[state.editedSide], locale());
  if (state.mode === "manual") {
    const inverse = state.manual === null ? null : 1 / state.manual;
    state.manual = inverse !== null && Number.isFinite(inverse) ? inverse : null;
    $<HTMLInputElement>("manual-rate").value = state.manual === null ? "" : formatRate(state.manual);
  }
  $("swap-currencies").classList.toggle("swapped");
  if (state.mode === "auto") fetchRate(); else render();
});

for (const side of ["source", "target"] as const) {
  $(`${side}-currency`).addEventListener("click", () => {
    if (openSide === side) { closeMenu(); return; }
    closeMenu(); openSide = side;
    $(`${side}-menu`).hidden = false;
    $(`${side}-currency`).setAttribute("aria-expanded", "true");
    $(`${side}-search`).setAttribute("aria-expanded", "true");
    $<HTMLInputElement>(`${side}-search`).value = "";
    filterCurrencies(); $(`${side}-search`).focus();
  });
  $(`${side}-search`).addEventListener("input", filterCurrencies);
  $(`${side}-search`).addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); highlightOption(activeOption + (event.key === "ArrowDown" ? 1 : -1), true); }
    else if (event.key === "Enter") { event.preventDefault(); selectCurrency(activeOption); }
    else if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
  });
  $(`${side}-options`).addEventListener("click", event => {
    const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-index]") : null;
    if (option) selectCurrency(Number(option.dataset.index));
  });
  $<HTMLInputElement>(`${side}-thirteenth`).addEventListener("change", event => { state[`${side}Payments`] = (event.currentTarget as HTMLInputElement).checked ? 13 : 12; render(); });
}

document.addEventListener("pointerdown", event => { if (openSide && event.target instanceof Element && !event.target.closest(`[data-side="${openSide}"]`)) closeMenu(); });
document.addEventListener("focusin", event => { if (openSide && event.target instanceof Element && !event.target.closest(`[data-side="${openSide}"]`)) closeMenu(); });
for (const side of ["source", "target"] as const) {
  salaryField(side).addEventListener("input", event => { state.editedSide = side; state.value = formatSalaryInput(event.currentTarget as HTMLInputElement); render(); });
  salaryField(side).addEventListener("blur", () => { if (state.editedSide === side && state.value !== null) salaryField(side).value = amount(state.value, state[side], locale()); });
}
$<HTMLInputElement>("hours-per-week").addEventListener("input", event => {
  const value = parseAmount((event.currentTarget as HTMLInputElement).value, locale());
  state.hoursPerWeek = value !== null && value > 0 && value * 52 <= Number.MAX_SAFE_INTEGER ? value : null;
  render();
});
$<HTMLInputElement>("hours-per-week").addEventListener("blur", () => { if (state.hoursPerWeek !== null) $<HTMLInputElement>("hours-per-week").value = formatRate(state.hoursPerWeek); });
$<HTMLInputElement>("manual-rate").addEventListener("input", event => { const value = parseAmount((event.currentTarget as HTMLInputElement).value, locale()); state.manual = value !== null && value > 0 ? value : null; render(); });
$<HTMLInputElement>("manual-rate").addEventListener("blur", () => { if (state.manual !== null) $<HTMLInputElement>("manual-rate").value = formatRate(state.manual); });
for (const side of ["source", "target"] as const) {
  $(`${side === "source" ? "period" : "target-period"}-control`).querySelectorAll<HTMLButtonElement>("[data-period]").forEach(button => button.addEventListener("click", () => {
    if (state.hoursPerWeek === null) return;
    const previous = periodFor(side);
    const next = button.dataset.period;
    if (!isPeriod(next)) return;
    if (side === state.editedSide) {
      const converted = changePeriod(state.value, previous, next, state[`${side}Payments`], state.hoursPerWeek);
      if (state.value !== null && converted === null) return;
      state.value = converted;
      if (state.value !== null) salaryField(side).value = amount(state.value, state[side], locale());
    }
    state[side === "source" ? "period" : "targetPeriod"] = next;
    render();
  }));
}
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => button.addEventListener("click", () => {
  const mode = button.dataset.mode;
  if (mode !== "manual" && mode !== "auto") return;
  if (state.mode === mode) return;
  state.mode = mode;
  if (state.mode === "manual") {
    rateController?.abort(); ++requestNumber; state.loading = false;
    state.manual = state.quote?.rate ?? null;
    $<HTMLInputElement>("manual-rate").value = state.manual === null ? "" : formatRate(state.manual);
    render(); $<HTMLInputElement>("manual-rate").focus();
  } else fetchRate();
}));
$<HTMLSelectElement>("language").addEventListener("change", event => {
  const selected = (event.currentTarget as HTMLSelectElement).value;
  if (selected !== "pt" && selected !== "en") return;
  language = selected;
  try { localStorage.setItem("language", language); } catch { /* Calculation never depends on storage. */ }
  closeMenu(); setLanguage();
});
$("retry-rate").addEventListener("click", () => fetchRate(true));
$("retry-currencies").addEventListener("click", fetchCurrencies);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.mode === "auto" && Date.now() >= state.expires) fetchRate(); });
window.addEventListener("focus", () => { if (state.mode === "auto" && Date.now() >= state.expires) fetchRate(); });
compare = mountCompare(() => language, () => currencies);
const tabs = ["convert", "compare", "brazil"] as const;
const brazilPanel = $("brazil-panel");
function selectTab(tab: typeof tabs[number], focus = false) {
  closeMenu();
  for (const name of tabs) {
    const selected = name === tab;
    const button = $<HTMLButtonElement>(`tab-${name}`);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`${name}-panel`).hidden = !selected;
  }
  if (focus) $(`tab-${tab}`).focus();
  if (tab === "compare") compare?.activate();
  if (tab === "brazil") {
    if (brazil) brazil.activate();
    else if (!brazilLoading) {
      brazilLoading = true;
      import("./brazil").then(({ mountBrazil }) => {
      if (document.getElementById("brazil-panel") !== brazilPanel) return;
      brazil = mountBrazil(() => language, () => currencies);
      brazil.activate();
      }).finally(() => { brazilLoading = false; });
    }
  }
}
for (const tab of tabs) {
  $(`tab-${tab}`).addEventListener("click", () => selectTab(tab));
  $(`tab-${tab}`).addEventListener("keydown", event => {
    const index = tabs.indexOf(tab);
    const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length]
      : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
    if (next) { event.preventDefault(); selectTab(next, true); }
  });
}
setLanguage();
fetchCurrencies();
fetchRate();
