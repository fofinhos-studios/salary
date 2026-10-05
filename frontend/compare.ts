import { amount, calculate, changePeriod, compareSalaries, formatSalaryText, money, parseAmount, searchKey, type Payments, type Period } from "./core";
import { rateSchema, type Currency, type Rate } from "./contracts";
import { flagFor } from "./flags";
import { messages, type Language, type MessageKey } from "./i18n";

type Side = "a" | "b";
type Offer = { value: number | null; currency: string; period: Period; payments: Payments; hours: number | null };
type RateState = { mode: "auto" | "manual"; manual: number | null; quote: Rate | null; expires: number; loading: boolean; error: boolean };

export function mountCompare(getLanguage: () => Language, getCurrencies: () => Currency[]) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element: ${id}`);
    return element as T;
  };
  const id = (side: Side, part: string) => `compare-${side}-${part}`;
  const field = (side: Side) => $<HTMLInputElement>(id(side, "salary"));
  const hoursField = (side: Side) => $<HTMLInputElement>(id(side, "hours"));
  const locale = () => getLanguage() === "pt" ? "pt-BR" : "en-US";
  const t = (key: MessageKey) => messages[getLanguage()][key];
  const offers: Record<Side, Offer> = {
    a: { value: null, currency: "USD", period: "annual", payments: 12, hours: 40 },
    b: { value: null, currency: "USD", period: "annual", payments: 12, hours: 40 },
  };
  const rateState: RateState = { mode: "auto", manual: null, quote: null, expires: 0, loading: false, error: false };
  let currencyMode: "same" | "different" = "same";
  let openSide: Side | null = null;
  let activeOption = -1;
  let visibleCurrencies: Currency[] = [];
  let currencyNames = new Map<string, string>();
  let controller: AbortController | undefined;
  let requestNumber = 0;
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;

  const currencyName = (code: string) => currencyNames.get(code) || code;
  const rate = () => offers.a.currency === offers.b.currency ? 1 : rateState.mode === "manual" ? rateState.manual : rateState.quote?.rate ?? null;
  const own = (side: Side) => {
    const offer = offers[side];
    return calculate(offer.value, offer.period, offer.payments, offer.payments, 1, offer.hours);
  };
  const showError = (elementId: string, message: string) => {
    const element = $(elementId);
    element.textContent = message;
    element.hidden = !message;
  };
  const formatRate = (value: number) => new Intl.NumberFormat(locale(), { maximumSignificantDigits: 12 }).format(value);

  function rebuildNames() {
    const names = new Intl.DisplayNames([locale()], { type: "currency" });
    currencyNames = new Map(getCurrencies().map(({ code, name }) => {
      const translated = names.of(code);
      return [code, translated && translated !== code ? translated : name];
    }));
  }

  function renderCurrency(side: Side) {
    const code = offers[side].currency;
    $<HTMLImageElement>(id(side, "flag")).src = flagFor(code);
    const selected = $(id(side, "selection")).querySelector("strong");
    if (selected) selected.textContent = code;
    $(id(side, "name")).textContent = currencyName(code);
    $(id(side, "code")).textContent = code;
  }

  function differenceText(elementId: string, inA: number, inB: number) {
    const element = $(elementId);
    const signed = (value: number, currency: string) => `${value > 0 ? "+" : ""}${money(value, currency, locale())}`;
    const parts = [signed(inA, offers.a.currency)];
    if (offers.a.currency !== offers.b.currency) parts.push(signed(inB, offers.b.currency));
    element.replaceChildren();
    parts.forEach((part, index) => {
      if (index) element.append(document.createTextNode(" · "));
      const span = document.createElement("span");
      span.textContent = part;
      element.append(span);
    });
  }

  function render() {
    for (const side of ["a", "b"] as const) {
      const offer = offers[side];
      const result = own(side);
      renderCurrency(side);
      const equivalents = (["annual", "monthly", "hourly"] as const)
        .filter(period => period !== offer.period)
        .map(period => `${result ? money(result[period], offer.currency, locale()) : "—"} ${t(period === "annual" ? "perYear" : period === "monthly" ? "perMonth" : "perHour")}`);
      $(id(side, "equivalent")).textContent = equivalents.join(" · ");
      const invalidSalary = field(side).value.trim() !== "" && offer.value === null;
      const tooLarge = offer.value !== null && offer.hours !== null && !result;
      showError(id(side, "error"), invalidSalary ? t("invalidAmount") : tooLarge ? t("tooLarge") : "");
      field(side).setAttribute("aria-invalid", String(invalidSalary || tooLarge));
      showError(id(side, "hours-error"), offer.hours === null ? t("invalidHours") : "");
      hoursField(side).setAttribute("aria-invalid", String(offer.hours === null));
      $(id(side, "payments")).textContent = t(offer.period === "hourly" ? "hourlyNoThirteenth" : offer.payments === 13 ? "payments13" : "payments12");
      $<HTMLInputElement>(id(side, "thirteenth")).disabled = offer.period === "hourly";
      $(id(side, "period-control")).querySelectorAll<HTMLButtonElement>("[data-period]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.period === offer.period));
        button.disabled = offer.hours === null && button.dataset.period !== offer.period;
      });
    }
    $("compare-currency-mode").querySelectorAll<HTMLButtonElement>("[data-compare-currency-mode]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.compareCurrencyMode === currencyMode)));
    $("compare-rate-mode").querySelectorAll<HTMLButtonElement>("[data-compare-rate-mode]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.compareRateMode === rateState.mode));
      button.disabled = offers.a.currency === offers.b.currency;
    });
    const activeRate = rate();
    $("compare-manual-field").hidden = rateState.mode !== "manual" || offers.a.currency === offers.b.currency;
    const invalidManual = rateState.mode === "manual" && $<HTMLInputElement>("compare-manual-rate").value.trim() !== "" && !(rateState.manual !== null && rateState.manual > 0);
    showError("compare-manual-error", invalidManual ? t("invalidRate") : "");
    $("compare-manual-rate").setAttribute("aria-invalid", String(invalidManual));
    $("compare-manual-label").textContent = `${offers.b.currency} ${t("perOne")} ${offers.a.currency}`;
    $("compare-rate-display").textContent = activeRate !== null && activeRate > 0
      ? `1 ${offers.a.currency} = ${formatRate(activeRate)} ${offers.b.currency}`
      : `${offers.a.currency} → ${offers.b.currency}`;
    let detail: string;
    if (offers.a.currency === offers.b.currency) detail = t("sameCurrency");
    else if (rateState.mode === "manual") detail = t("manualDetail");
    else if (rateState.loading) detail = t("loading");
    else if (rateState.error) detail = t("rateUnavailable");
    else if (rateState.quote?.date) {
      const reference = new Date(`${rateState.quote.date}T12:00:00Z`).toLocaleDateString(locale(), { timeZone: "UTC" });
      detail = `${t("reference")} ${reference}${rateState.quote.stale ? ` · ${t("stale")}` : ""}`;
    } else detail = t("loading");
    $("compare-rate-detail").textContent = detail;
    $("compare-rate-detail").classList.toggle("error", rateState.mode === "auto" && rateState.error);
    $("compare-retry-rate").hidden = rateState.mode !== "auto" || !(rateState.error || rateState.quote?.stale) || rateState.loading;

    const comparison = compareSalaries(own("a"), own("b"), activeRate);
    const results = $("compare-results-title").closest<HTMLElement>(".compare-results")!;
    const direction = !comparison ? "neutral" : comparison.annual.inA > 0 ? "up" : comparison.annual.inA < 0 ? "down" : "neutral";
    results.dataset.trend = direction;
    $("compare-trend-icon").className = `ph ph-${direction === "up" ? "trend-up" : direction === "down" ? "trend-down" : "equals"}`;
    $("compare-percent").textContent = comparison?.percent === null || !comparison
      ? "—" : `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(comparison.percent)}%`;
    const empty = offers.a.value === null || offers.b.value === null;
    $("compare-trend").textContent = !comparison ? t(empty ? "compareEmpty" : "compareUnavailable")
      : `${t(direction === "up" ? "annualIncrease" : direction === "down" ? "annualDecrease" : "noChange")}${comparison.percent === null ? ` · ${t("percentageUnavailable")}` : ""}`;
    if (comparison) {
      differenceText("compare-annual", comparison.annual.inA, comparison.annual.inB);
      differenceText("compare-monthly", comparison.monthly.inA, comparison.monthly.inB);
      differenceText("compare-hourly", comparison.hourly.inA, comparison.hourly.inB);
    } else for (const part of ["annual", "monthly", "hourly"]) $(`compare-${part}`).textContent = "—";
    for (const period of ["monthly", "hourly"] as const) {
      const delta = comparison?.[period].inA;
      $(`compare-${period}`).dataset.trend = delta === undefined ? "neutral" : delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
    }
    clearTimeout(announcementTimer);
    if (!$('compare-panel').hidden) announcementTimer = setTimeout(() => {
      $("compare-announcement").textContent = comparison
        ? `${t("compareResult")}: ${$("compare-percent").textContent}, ${$("compare-annual").textContent}`
        : t(empty ? "compareEmpty" : "compareUnavailable");
    }, 650);
  }

  async function fetchRate(force = false) {
    controller?.abort();
    const current = ++requestNumber;
    if (rateState.mode !== "auto") return;
    if (offers.a.currency === offers.b.currency) {
      rateState.quote = null; rateState.loading = false; rateState.error = false; render(); return;
    }
    if (!force && rateState.quote?.base === offers.a.currency && rateState.quote?.quote === offers.b.currency && Date.now() < rateState.expires) { render(); return; }
    const base = offers.a.currency, quote = offers.b.currency;
    rateState.quote = null;
    rateState.error = false;
    rateState.loading = true;
    render();
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => activeController.abort(), 12000);
    try {
      const response = await fetch(`/api/rate?${new URLSearchParams({ base, quote })}`, { signal: activeController.signal });
      if (!response.ok) throw new Error("rate_unavailable");
      const parsed = rateSchema.safeParse(await response.json() as unknown);
      if (!parsed.success || parsed.data.base !== base || parsed.data.quote !== quote) throw new Error("invalid_rate");
      if (current !== requestNumber) return;
      rateState.quote = parsed.data;
      rateState.expires = Date.now() + parsed.data.max_age * 1000;
    } catch {
      if (current !== requestNumber) return;
      rateState.error = true;
    } finally {
      clearTimeout(timeout);
      if (current === requestNumber) { rateState.loading = false; render(); }
    }
  }

  function closeMenu(restoreFocus = false) {
    if (!openSide) return;
    const side = openSide;
    $(id(side, "menu")).hidden = true;
    $(id(side, "currency")).setAttribute("aria-expanded", "false");
    $(id(side, "search")).setAttribute("aria-expanded", "false");
    $(id(side, "search")).removeAttribute("aria-activedescendant");
    openSide = null;
    if (restoreFocus) $(id(side, "currency")).focus();
  }

  function highlightOption(index: number, scroll = false) {
    if (!openSide) return;
    const options = [...$(id(openSide, "options")).children];
    activeOption = options.length ? (index + options.length) % options.length : -1;
    options.forEach((option, optionIndex) => option.classList.toggle("active", optionIndex === activeOption));
    const search = $(id(openSide, "search"));
    if (activeOption < 0) search.removeAttribute("aria-activedescendant");
    else {
      const option = options[activeOption]!;
      search.setAttribute("aria-activedescendant", option.id);
      if (scroll) option.scrollIntoView({ block: "nearest" });
    }
  }

  function filterCurrencies() {
    if (!openSide) return;
    const side = openSide;
    const query = searchKey($<HTMLInputElement>(id(side, "search")).value);
    visibleCurrencies = getCurrencies().filter(item => searchKey(`${item.code} ${currencyName(item.code)} ${item.name}`).includes(query));
    const fragment = document.createDocumentFragment();
    visibleCurrencies.forEach(({ code }, index) => {
      const option = document.createElement("div");
      option.className = "currency-option";
      option.id = id(side, `option-${code}`);
      option.dataset.index = String(index);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(code === offers[side].currency));
      const flag = document.createElement("img");
      flag.src = flagFor(code); flag.alt = ""; flag.loading = "lazy"; flag.width = 24; flag.height = 18;
      const codeElement = document.createElement("span");
      codeElement.className = "code"; codeElement.textContent = code;
      const name = document.createElement("span");
      name.className = "name"; name.textContent = currencyName(code);
      option.append(flag, codeElement, name);
      if (code === offers[side].currency) {
        const check = document.createElement("i");
        check.className = "ph ph-check selected-icon";
        check.setAttribute("aria-hidden", "true");
        option.append(check);
      }
      fragment.append(option);
    });
    $(id(side, "options")).replaceChildren(fragment);
    const empty = $(id(side, "menu")).querySelector<HTMLElement>(".empty-search");
    if (empty) empty.hidden = visibleCurrencies.length > 0;
    highlightOption(Math.max(0, visibleCurrencies.findIndex(item => item.code === offers[side].currency)));
  }

  function selectCurrency(index: number) {
    const selected = visibleCurrencies[index];
    if (!selected || !openSide) return;
    const side = openSide;
    const changed = offers[side].currency !== selected.code || currencyMode === "same" && offers[side === "a" ? "b" : "a"].currency !== selected.code;
    offers[side].currency = selected.code;
    if (currencyMode === "same") offers[side === "a" ? "b" : "a"].currency = selected.code;
    closeMenu(true);
    if (!changed) return;
    for (const current of ["a", "b"] as const) if (offers[current].value !== null) field(current).value = amount(offers[current].value, offers[current].currency, locale());
    rateState.mode = "auto";
    rateState.manual = null;
    $<HTMLInputElement>("compare-manual-rate").value = "";
    fetchRate();
  }

  for (const side of ["a", "b"] as const) {
    $(id(side, "currency")).addEventListener("click", () => {
      if (openSide === side) { closeMenu(); return; }
      closeMenu(); openSide = side;
      $(id(side, "menu")).hidden = false;
      $(id(side, "currency")).setAttribute("aria-expanded", "true");
      $(id(side, "search")).setAttribute("aria-expanded", "true");
      $<HTMLInputElement>(id(side, "search")).value = "";
      filterCurrencies(); $(id(side, "search")).focus();
    });
    $(id(side, "search")).addEventListener("input", filterCurrencies);
    $(id(side, "search")).addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); highlightOption(activeOption + (event.key === "ArrowDown" ? 1 : -1), true); }
      else if (event.key === "Enter") { event.preventDefault(); selectCurrency(activeOption); }
      else if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    });
    $(id(side, "options")).addEventListener("click", event => {
      const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-index]") : null;
      if (option) selectCurrency(Number(option.dataset.index));
    });
    field(side).addEventListener("input", () => {
      const input = field(side);
      const result = formatSalaryText(input.value, input.selectionStart ?? input.value.length, locale());
      if (result && result.text !== input.value) { input.value = result.text; input.setSelectionRange(result.cursor, result.cursor); }
      offers[side].value = result?.value ?? null;
      render();
    });
    field(side).addEventListener("blur", () => { if (offers[side].value !== null) field(side).value = amount(offers[side].value, offers[side].currency, locale()); });
    hoursField(side).addEventListener("input", () => {
      const value = parseAmount(hoursField(side).value, locale());
      offers[side].hours = value !== null && value > 0 && value * 52 <= Number.MAX_SAFE_INTEGER ? value : null;
      render();
    });
    hoursField(side).addEventListener("blur", () => { if (offers[side].hours !== null) hoursField(side).value = formatRate(offers[side].hours); });
    $<HTMLInputElement>(id(side, "thirteenth")).addEventListener("change", () => {
      offers[side].payments = $<HTMLInputElement>(id(side, "thirteenth")).checked ? 13 : 12;
      render();
    });
    $(id(side, "period-control")).querySelectorAll<HTMLButtonElement>("[data-period]").forEach(button => button.addEventListener("click", () => {
      const next = button.dataset.period;
      if (offers[side].hours === null || next !== "annual" && next !== "monthly" && next !== "hourly") return;
      const converted = changePeriod(offers[side].value, offers[side].period, next, offers[side].payments, offers[side].hours);
      if (offers[side].value !== null && converted === null) return;
      offers[side].period = next;
      offers[side].value = converted;
      if (converted !== null) field(side).value = amount(converted, offers[side].currency, locale());
      render();
    }));
  }
  document.addEventListener("pointerdown", event => { if (openSide && event.target instanceof Element && !event.target.closest(`[data-compare-side="${openSide}"]`)) closeMenu(); });
  document.addEventListener("focusin", event => { if (openSide && event.target instanceof Element && !event.target.closest(`[data-compare-side="${openSide}"]`)) closeMenu(); });
  $("compare-currency-mode").querySelectorAll<HTMLButtonElement>("[data-compare-currency-mode]").forEach(button => button.addEventListener("click", () => {
    const next = button.dataset.compareCurrencyMode;
    if (next !== "same" && next !== "different" || next === currencyMode) return;
    currencyMode = next;
    closeMenu();
    if (next === "same") offers.b.currency = offers.a.currency;
    for (const side of ["a", "b"] as const) if (offers[side].value !== null) field(side).value = amount(offers[side].value, offers[side].currency, locale());
    rateState.mode = "auto";
    rateState.manual = null;
    $<HTMLInputElement>("compare-manual-rate").value = "";
    fetchRate();
  }));
  $("compare-rate-mode").querySelectorAll<HTMLButtonElement>("[data-compare-rate-mode]").forEach(button => button.addEventListener("click", () => {
    const next = button.dataset.compareRateMode;
    if (next !== "auto" && next !== "manual" || next === rateState.mode || offers.a.currency === offers.b.currency) return;
    rateState.mode = next;
    if (next === "manual") {
      controller?.abort(); ++requestNumber; rateState.loading = false;
      rateState.manual = rateState.quote?.rate ?? null;
      $<HTMLInputElement>("compare-manual-rate").value = rateState.manual === null ? "" : formatRate(rateState.manual);
      render(); $("compare-manual-rate").focus();
    } else fetchRate();
  }));
  $<HTMLInputElement>("compare-manual-rate").addEventListener("input", () => {
    const value = parseAmount($<HTMLInputElement>("compare-manual-rate").value, locale());
    rateState.manual = value !== null && value > 0 ? value : null;
    render();
  });
  $<HTMLInputElement>("compare-manual-rate").addEventListener("blur", () => {
    if (rateState.manual !== null) $<HTMLInputElement>("compare-manual-rate").value = formatRate(rateState.manual);
  });
  $("compare-retry-rate").addEventListener("click", () => fetchRate(true));
  $("compare-reverse").addEventListener("click", () => {
    closeMenu();
    const amountA = field("a").value, amountB = field("b").value;
    const hoursA = hoursField("a").value, hoursB = hoursField("b").value;
    [offers.a, offers.b] = [offers.b, offers.a];
    field("a").value = amountB; field("b").value = amountA;
    hoursField("a").value = hoursB; hoursField("b").value = hoursA;
    for (const side of ["a", "b"] as const) $<HTMLInputElement>(id(side, "thirteenth")).checked = offers[side].payments === 13;
    if (rateState.mode === "manual") {
      const inverse = rateState.manual === null ? null : 1 / rateState.manual;
      rateState.manual = inverse !== null && Number.isFinite(inverse) ? inverse : null;
      $<HTMLInputElement>("compare-manual-rate").value = rateState.manual === null ? "" : formatRate(rateState.manual);
    }
    if (rateState.mode === "auto") fetchRate(); else render();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && rateState.mode === "auto" && Date.now() >= rateState.expires) fetchRate(); });
  window.addEventListener("focus", () => { if (rateState.mode === "auto" && Date.now() >= rateState.expires) fetchRate(); });

  function setLanguage() {
    rebuildNames();
    for (const side of ["a", "b"] as const) {
      $<HTMLInputElement>(id(side, "search")).placeholder = t("search");
      $(id(side, "search")).setAttribute("aria-label", `${t(side === "a" ? "salaryA" : "salaryB")}: ${t("search")}`);
      $(id(side, "period-control")).setAttribute("aria-label", `${t(side === "a" ? "salaryA" : "salaryB")}: ${t("salaryPeriod")}`);
      if (offers[side].value !== null) field(side).value = amount(offers[side].value, offers[side].currency, locale());
      if (offers[side].hours !== null) hoursField(side).value = formatRate(offers[side].hours);
    }
    $("compare-currency-mode").setAttribute("aria-label", t("currencyMode"));
    $("compare-rate-mode").setAttribute("aria-label", t("rateMode"));
    if (rateState.manual !== null) $<HTMLInputElement>("compare-manual-rate").value = formatRate(rateState.manual);
    if (openSide) filterCurrencies();
    render();
  }

  setLanguage();
  return {
    setLanguage,
    refreshCurrencies: () => { rebuildNames(); if (openSide) filterCurrencies(); render(); },
    activate: () => { if (rateState.mode === "auto" && Date.now() >= rateState.expires) fetchRate(); else render(); },
  };
}
