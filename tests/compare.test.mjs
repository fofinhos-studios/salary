import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, test, vi } from "vitest";

const html = readFileSync("static/index.html", "utf8");
const catalogue = { currencies: [
  { code: "USD", name: "US Dollar" }, { code: "BRL", name: "Brazilian Real" }, { code: "EUR", name: "Euro" },
] };
const quote = (base, target, rate) => ({ base, quote: target, rate, date: "2026-10-02", source: "Frankfurter", stale: false, max_age: 3600 });
const reply = data => ({ ok: true, json: async () => data });
const fail = () => ({ ok: false, json: async () => ({ error: "rate_unavailable" }) });
const el = id => document.getElementById(id);
const click = selector => document.querySelector(selector).click();
const input = (id, value) => { el(id).value = value; el(id).dispatchEvent(new window.Event("input", { bubbles: true })); };
const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new window.Event("change", { bubbles: true })); };
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function mount(fetcher = async url => {
  if (String(url).includes("/api/currencies")) return reply(catalogue);
  const { searchParams } = new URL(String(url), "http://localhost");
  const base = searchParams.get("base"), target = searchParams.get("quote");
  return reply(quote(base, target, base === "BRL" ? .2 : 5));
}) {
  vi.useFakeTimers();
  const dom = new JSDOM(html, { url: "http://localhost" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("Event", dom.window.Event);
  const fetch = vi.fn(fetcher);
  vi.stubGlobal("fetch", fetch);
  vi.resetModules();
  await import("../frontend/app.ts");
  await settle();
  return { dom, fetch };
}
function select(side, code) {
  click(`#compare-${side}-currency`);
  input(`compare-${side}-search`, code);
  el(`compare-${side}-search`).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("tabs preserve independent inputs and support keyboard navigation", async () => {
  await mount();
  input("salary", "120000");
  click("#tab-compare");
  assert.equal(el("compare-panel").hidden, false);
  assert.equal(el("compare-a-salary").value, "");
  input("compare-a-salary", "90000");
  el("tab-compare").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(el("convert-panel").hidden, false);
  assert.equal(el("salary").value, "120,000");
  click("#tab-compare");
  assert.equal(el("compare-a-salary").value, "90,000");
  assert.equal(el("tab-compare").getAttribute("aria-selected"), "true");
  el("tab-compare").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  el("tab-convert").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(el("compare-panel").hidden, false);
  el("tab-compare").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  el("tab-convert").dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(el("brazil-panel").hidden, false);
});

test("same-currency salaries update live, including 13 payments and different hours", async () => {
  await mount();
  click("#tab-compare");
  input("compare-a-salary", "120000");
  input("compare-b-salary", "150000");
  assert.equal(el("compare-a-salary").value, "120,000");
  assert.equal(el("compare-percent").textContent, "+25%");
  assert.match(el("compare-annual").textContent, /USD\s+30,000\.00/);
  assert.equal(el("compare-results-title").closest(".compare-results").dataset.trend, "up");
  el("compare-b-thirteenth").checked = true;
  el("compare-b-thirteenth").dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(el("compare-monthly").textContent, /1,538\.46/);
  input("compare-b-hours", "20");
  assert.match(el("compare-hourly").textContent, /86\.54/);
  click('#compare-b-period-control [data-period="monthly"]');
  assert.match(el("compare-b-salary").value, /11,538/);
  assert.equal(el("compare-percent").textContent, "+25%");
  click('#compare-b-period-control [data-period="hourly"]');
  assert.equal(el("compare-b-thirteenth").disabled, true);
  vi.advanceTimersByTime(650);
  assert.match(el("compare-announcement").textContent, /Salary comparison/);
});

test("currency selectors change independently and the toggle can explicitly match them", async () => {
  const { fetch } = await mount();
  click("#tab-compare");
  select("a", "BRL");
  await settle();
  assert.equal(el("compare-b-selection").querySelector("strong").textContent, "USD");
  assert.equal(document.querySelector('[data-compare-currency-mode="different"]').getAttribute("aria-pressed"), "true");
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length, 2);
  select("b", "BRL");
  assert.equal(el("compare-a-selection").querySelector("strong").textContent, "BRL");
  assert.equal(document.querySelector('[data-compare-currency-mode="same"]').getAttribute("aria-pressed"), "true");
  select("b", "USD");
  await settle();
  assert.match(el("compare-rate-display").textContent, /0\.2 USD/);
  input("compare-a-salary", "600000");
  input("compare-b-salary", "150000");
  assert.equal(el("compare-percent").textContent, "+25%");
  assert.match(el("compare-annual").textContent, /BRL\s+150,000\.00/);
  assert.match(el("compare-annual").textContent, /USD\s+30,000\.00/);
  click('[data-compare-currency-mode="same"]');
  assert.equal(el("compare-b-selection").querySelector("strong").textContent, "BRL");
  assert.equal(el("compare-rate-mode").querySelector('[data-compare-rate-mode="manual"]').disabled, true);
});

test("reverse swaps complete offers and the percentage baseline", async () => {
  await mount();
  click("#tab-compare");
  input("compare-a-salary", "120000");
  input("compare-b-salary", "150000");
  input("compare-a-hours", "35");
  input("compare-b-hours", "20");
  el("compare-b-thirteenth").checked = true;
  el("compare-b-thirteenth").dispatchEvent(new window.Event("change", { bubbles: true }));
  click("#compare-reverse");
  assert.equal(el("compare-a-salary").value, "150,000");
  assert.equal(el("compare-a-hours").value, "20");
  assert.equal(el("compare-a-thirteenth").checked, true);
  assert.equal(el("compare-percent").textContent, "-20%");
  assert.equal(el("compare-results-title").closest(".compare-results").dataset.trend, "down");
});

test("manual rate, reverse, automatic rate, and rate failure are handled", async () => {
  const { fetch } = await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    return searchParams.get("base") === "BRL" ? reply(quote("BRL", "USD", .2)) : fail();
  });
  click("#tab-compare");
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  await settle();
  input("compare-a-salary", "120000");
  input("compare-b-salary", "750000");
  assert.equal(el("compare-percent").textContent, "—");
  assert.equal(el("compare-retry-rate").hidden, false);
  click('[data-compare-rate-mode="manual"]');
  input("compare-manual-rate", "5");
  assert.equal(el("compare-percent").textContent, "+25%");
  click("#compare-reverse");
  assert.equal(el("compare-manual-rate").value, "0.2");
  assert.equal(el("compare-percent").textContent, "-20%");
  click('[data-compare-rate-mode="auto"]');
  await settle();
  assert.match(el("compare-rate-display").textContent, /0\.2 USD/);
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length, 3);
});

test("zero baseline, invalid inputs, locale switch, and stale rate details", async () => {
  await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    return reply({ ...quote(searchParams.get("base"), searchParams.get("quote"), 5), stale: true, max_age: 60 });
  });
  click("#tab-compare");
  input("compare-a-salary", "0");
  input("compare-b-salary", "1000");
  assert.equal(el("compare-percent").textContent, "—");
  assert.match(el("compare-trend").textContent, /zero baseline/);
  input("compare-a-salary", "bad");
  assert.equal(el("compare-a-salary").getAttribute("aria-invalid"), "true");
  assert.equal(el("compare-annual").textContent, "—");
  input("compare-a-salary", "120000");
  input("compare-a-hours", "0");
  assert.equal(el("compare-a-hours").getAttribute("aria-invalid"), "true");
  click('#compare-a-period-control [data-period="monthly"]');
  assert.equal(el("compare-a-period-control").querySelector('[data-period="annual"]').getAttribute("aria-pressed"), "true");
  input("compare-a-hours", "40");
  change("language", "pt");
  assert.equal(el("compare-a-salary").value, "120.000");
  assert.match(el("compare-results-title").textContent, /Diferença anual/);
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  await settle();
  assert.match(el("compare-rate-detail").textContent, /cache/);
  assert.equal(el("compare-retry-rate").hidden, false);
});

test("currency menu, manual validation, and empty reverse work", async () => {
  await mount();
  click("#tab-compare");
  click("#compare-a-currency");
  input("compare-a-search", "NO_MATCH");
  assert.equal(document.querySelector("#compare-a-menu .empty-search").hidden, false);
  el("compare-a-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(el("compare-a-menu").hidden, true);
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  await settle();
  click('[data-compare-rate-mode="manual"]');
  input("compare-manual-rate", "0");
  assert.equal(el("compare-manual-rate").getAttribute("aria-invalid"), "true");
  click("#compare-reverse");
  assert.equal(el("compare-manual-rate").value, "");
  input("compare-manual-rate", "2.5");
  el("compare-manual-rate").dispatchEvent(new window.Event("blur"));
  assert.equal(el("compare-manual-rate").value, "2.5");
});

test("equal salaries are neutral and zero salaries keep a numeric difference", async () => {
  await mount();
  click("#tab-compare");
  input("compare-a-salary", "1000");
  input("compare-b-salary", "1000");
  assert.equal(el("compare-percent").textContent, "0%");
  assert.equal(el("compare-results-title").closest(".compare-results").dataset.trend, "neutral");
  assert.match(el("compare-trend").textContent, /No annual change/);
  input("compare-a-salary", "0");
  input("compare-b-salary", "0");
  assert.equal(el("compare-percent").textContent, "—");
  assert.match(el("compare-annual").textContent, /0\.00/);
  vi.advanceTimersByTime(650);
  assert.match(el("compare-announcement").textContent, /Salary comparison/);
});

test("monthly payment direction can differ from annual direction", async () => {
  await mount();
  click("#tab-compare");
  input("compare-a-salary", "120000");
  input("compare-b-salary", "126000");
  el("compare-b-thirteenth").checked = true;
  el("compare-b-thirteenth").dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(el("compare-percent").textContent, "+5%");
  assert.equal(el("compare-results-title").closest(".compare-results").dataset.trend, "up");
  assert.equal(el("compare-monthly").dataset.trend, "down");
  assert.match(el("compare-monthly").textContent, /-USD\s+307\.69/);
});

test("currency menu changes only the chosen side and supports pointer and keyboard dismissal", async () => {
  await mount();
  click("#tab-compare");
  click("#compare-b-currency");
  input("compare-b-search", "BRL");
  click("#compare-b-options [data-index]");
  assert.equal(el("compare-a-selection").querySelector("strong").textContent, "USD");
  click("#compare-b-currency");
  assert.equal(el("compare-b-menu").hidden, false);
  click("#compare-b-currency");
  assert.equal(el("compare-b-menu").hidden, true);
  click("#compare-a-currency");
  el("compare-a-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  el("compare-a-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  assert.equal(el("compare-a-menu").hidden, true);
  click("#compare-a-currency");
  document.body.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  assert.equal(el("compare-a-menu").hidden, true);
  click("#compare-a-currency");
  input("compare-a-search", "BRL");
  el("compare-a-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(el("compare-a-menu").hidden, true);
});

test("retry recovers a failed comparison and automatic quote reverses", async () => {
  let attempts = 0;
  await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    const base = searchParams.get("base"), target = searchParams.get("quote");
    return ++attempts === 3 ? reply(quote(base, target, 5))
      : attempts === 4 ? reply(quote(base, target, .2)) : fail();
  });
  click("#tab-compare");
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  await settle();
  input("compare-a-salary", "120000");
  input("compare-b-salary", "750000");
  assert.match(el("compare-trend").textContent, /unavailable/);
  click("#compare-retry-rate");
  await settle();
  assert.equal(el("compare-percent").textContent, "+25%");
  click("#compare-reverse");
  await settle();
  assert.equal(el("compare-a-selection").querySelector("strong").textContent, "BRL");
  assert.equal(el("compare-b-selection").querySelector("strong").textContent, "USD");
  assert.equal(el("compare-percent").textContent, "-20%");
});

test("typing and blur keep cursor, decimal text, and localized manual rate", async () => {
  await mount();
  click("#tab-compare");
  const salary = el("compare-a-salary");
  for (const digit of "235000") {
    salary.setRangeText(digit, salary.selectionStart, salary.selectionEnd, "end");
    salary.dispatchEvent(new window.Event("input", { bubbles: true }));
  }
  assert.equal(salary.value, "235,000");
  input("compare-a-salary", "1234.50");
  assert.equal(salary.value, "1,234.50");
  salary.dispatchEvent(new window.Event("blur"));
  assert.equal(salary.value, "1,234.5");
  input("compare-b-hours", "37.5");
  el("compare-b-hours").dispatchEvent(new window.Event("blur"));
  assert.equal(el("compare-b-hours").value, "37.5");
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  await settle();
  click('[data-compare-rate-mode="manual"]');
  input("compare-manual-rate", "2.5");
  change("language", "pt");
  assert.equal(el("compare-manual-rate").value, "2,5");
  assert.equal(salary.value, "1.234,5");
  input("compare-b-salary", "1234,50");
  assert.equal(el("compare-b-salary").value, "1.234,50");
});

test("obsolete rate responses and focus refresh cannot replace a newer currency", async () => {
  const pending = [];
  const { fetch } = await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    if (searchParams.get("base") === "USD" && searchParams.get("quote") === "BRL") return new Promise(resolve => pending.push(resolve));
    return reply(quote(searchParams.get("base"), searchParams.get("quote"), 2));
  });
  click("#tab-compare");
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  select("b", "EUR");
  await settle();
  pending[0](reply(quote("USD", "BRL", 5)));
  await settle();
  assert.match(el("compare-rate-display").textContent, /2 EUR/);
  window.dispatchEvent(new window.Event("focus"));
  await settle();
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate") && String(url).includes("quote=EUR")).length, 1);
  vi.setSystemTime(Date.now() + 4_000_000);
  window.dispatchEvent(new window.Event("focus"));
  await settle();
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate") && String(url).includes("quote=EUR")).length, 2);
});

test("invalid rate payload, invalid manual rate, and retry preserve entered salaries", async () => {
  let attempts = 0;
  await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    const base = searchParams.get("base"), target = searchParams.get("quote");
    const data = quote(base, target, 5);
    return reply(++attempts === 2 ? { ...data, rate: -5 } : data);
  });
  click("#tab-compare");
  input("compare-a-salary", "120000");
  input("compare-b-salary", "750000");
  click('[data-compare-currency-mode="different"]');
  select("b", "BRL");
  await settle();
  assert.equal(el("compare-annual").textContent, "—");
  assert.equal(el("compare-retry-rate").hidden, false);
  click('[data-compare-rate-mode="manual"]');
  input("compare-manual-rate", "0");
  assert.equal(el("compare-annual").textContent, "—");
  vi.advanceTimersByTime(650);
  assert.match(el("compare-announcement").textContent, /unavailable/);
  click('[data-compare-rate-mode="auto"]');
  await settle();
  assert.equal(el("compare-a-salary").value, "120,000");
  assert.equal(el("compare-b-salary").value, "750,000");
  assert.equal(el("compare-percent").textContent, "+25%");
});

test("a rejected obsolete quote cannot erase the newer comparison", async () => {
  let rejectOld;
  await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    if (searchParams.get("quote") === "BRL" && rejectOld) return new Promise((_, reject) => { rejectOld = reject; });
    return reply(quote(searchParams.get("base"), searchParams.get("quote"), 2));
  });
  click("#tab-compare");
  click('[data-compare-currency-mode="different"]');
  // The first converter request has completed; hold the comparison's BRL quote.
  rejectOld = () => {};
  select("b", "BRL");
  select("b", "EUR");
  await settle();
  rejectOld(new Error("late failure"));
  await settle();
  assert.match(el("compare-rate-display").textContent, /2 EUR/);
  assert.equal(el("compare-rate-detail").classList.contains("error"), false);
});
