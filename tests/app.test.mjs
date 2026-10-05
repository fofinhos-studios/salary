import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, test, vi } from "vitest";

const html = readFileSync("static/index.html", "utf8");
const catalogue = { currencies: [
  { code: "USD", name: "US Dollar" }, { code: "BRL", name: "Brazilian Real" },
  { code: "EUR", name: "Euro" },
] };
const quote = (base = "USD", target = "BRL", rate = 5) => ({
  base, quote: target, rate, date: "2026-10-02", source: "Frankfurter", stale: false, max_age: 3600,
});
const reply = data => ({ ok: true, json: async () => data });
const fail = () => ({ ok: false, json: async () => ({ error: "rate_unavailable" }) });

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function mount(fetcher = async url => {
  if (String(url).startsWith("/api/currencies")) return reply(catalogue);
  const params = new URL(String(url), "http://localhost").searchParams;
  return reply(quote(params.get("base"), params.get("quote")));
}, setup = () => {}) {
  vi.useFakeTimers();
  const dom = new JSDOM(html, { url: "http://localhost" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
  const fetch = vi.fn(fetcher);
  vi.stubGlobal("fetch", fetch);
  setup(dom);
  vi.resetModules();
  await import("../frontend/app.ts");
  await settle();
  return { dom, fetch };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const el = id => document.getElementById(id);
function input(id, value) {
  el(id).value = value;
  el(id).dispatchEvent(new window.Event("input", { bubbles: true }));
}
function change(id, value) {
  el(id).value = value;
  el(id).dispatchEvent(new window.Event("change", { bubbles: true }));
}
function click(selector) { document.querySelector(selector).click(); }

test("initial API responses render a converted salary", async () => {
  const { fetch } = await mount();
  input("salary", "120000");
  assert.equal(el("target-salary").value, "50,000");
  assert.match(el("rate-display").textContent, /5 BRL/);
  assert.equal(fetch.mock.calls.length, 2);
});

test("salary inputs group digits while typing without moving the cursor or dropping decimals", async () => {
  await mount();
  for (const digit of "235000") {
    const field = el("salary");
    field.setRangeText(digit, field.selectionStart, field.selectionEnd, "end");
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  }
  assert.equal(el("salary").value, "235,000");
  input("salary", "1234.");
  assert.equal(el("salary").value, "1,234.");
  input("salary", "1234.50");
  assert.equal(el("salary").value, "1,234.50");

  input("salary", "12345");
  el("salary").setRangeText("9", 3, 3, "end");
  el("salary").dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(el("salary").value, "129,345");
  assert.equal(el("salary").selectionStart, 3);

  change("language", "pt");
  input("target-salary", "1234,50");
  assert.equal(el("target-salary").value, "1.234,50");
});

test("invalid catalogue preserves fallback and retry loads valid data", async () => {
  let attempts = 0;
  await mount(async url => String(url).includes("currencies")
    ? reply(++attempts === 1 ? { currencies: [] } : catalogue)
    : reply(quote()));
  assert.equal(el("catalogue-error").hidden, false);
  click("#retry-currencies");
  await settle();
  assert.equal(el("catalogue-error").hidden, true);
  click("#source-currency");
  input("source-search", "EUR");
  assert.match(el("source-options").textContent, /EUR/);
});

test("invalid rate shows error and retry accepts a valid rate", async () => {
  let attempts = 0;
  await mount(async url => String(url).includes("currencies") ? reply(catalogue)
    : reply(++attempts === 1 ? { ...quote(), rate: -1 } : quote()));
  assert.equal(el("retry-rate").hidden, false);
  click("#retry-rate");
  await settle();
  assert.equal(el("retry-rate").hidden, true);
  assert.match(el("rate-display").textContent, /5 BRL/);
});

test("server failure keeps the salary and allows manual entry", async () => {
  await mount(async url => String(url).includes("currencies") ? reply(catalogue) : fail());
  input("salary", "1000");
  assert.equal(el("target-salary").value, "");
  click('[data-mode="manual"]');
  input("manual-rate", "2.5");
  assert.equal(el("target-salary").value, "208.33");
  assert.equal(el("manual-field").hidden, false);
});

test("period and thirteenth controls preserve entered compensation", async () => {
  await mount();
  input("salary", "120000");
  click('#period-control [data-period="monthly"]');
  assert.equal(el("salary").value, "10,000");
  el("source-thirteenth").checked = true;
  el("source-thirteenth").dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(el("source-payments").textContent, /13/);
  click('#period-control [data-period="hourly"]');
  assert.equal(el("source-thirteenth").disabled, true);
});

test("target input uses inverse rate and locale switch keeps its value", async () => {
  await mount();
  input("target-salary", "50000");
  assert.equal(el("salary").value, "120,000");
  change("language", "pt");
  assert.equal(el("target-salary").value, "50.000");
  assert.equal(document.documentElement.lang, "pt-BR");
});

test("swap reverses currencies and fetches the inverse quote without moving the entered amount", async () => {
  const { fetch } = await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    const { searchParams } = new URL(String(url), "http://localhost");
    return reply(searchParams.get("base") === "BRL" ? quote("BRL", "USD", 0.2) : quote());
  });
  input("salary", "120000");
  click("#swap-currencies");
  await settle();
  assert.equal(el("source-selection").querySelector("strong").textContent, "BRL");
  assert.equal(el("target-selection").querySelector("strong").textContent, "USD");
  assert.equal(el("salary").value, "120,000");
  assert.equal(el("target-salary").value, "2,000");
  assert.match(String(fetch.mock.lastCall[0]), /base=BRL&quote=USD/);
  assert.equal(el("swap-currencies").classList.contains("swapped"), true);
  click("#swap-currencies");
  await settle();
  assert.equal(el("source-selection").querySelector("strong").textContent, "USD");
  assert.equal(el("swap-currencies").classList.contains("swapped"), false);
});

test("swap reciprocates a manual rate and preserves the edited target amount", async () => {
  const { fetch } = await mount();
  input("target-salary", "50000");
  click('[data-mode="manual"]');
  input("manual-rate", "5");
  click("#swap-currencies");
  assert.equal(el("target-salary").value, "50,000");
  assert.equal(el("manual-rate").value, "0.2");
  assert.equal(el("salary").value, "3,000,000");
  assert.equal(fetch.mock.calls.length, 2);
  change("language", "pt");
  assert.match(el("swap-currencies").textContent, /Inverter moedas/);
});

test("swap keeps an empty manual rate empty", async () => {
  await mount();
  click('[data-mode="manual"]');
  input("manual-rate", "");
  click("#swap-currencies");
  assert.equal(el("manual-rate").value, "");
  assert.equal(el("source-selection").querySelector("strong").textContent, "BRL");
});

test("currency search supports keyboard selection and resets manual mode", async () => {
  await mount();
  click('[data-mode="manual"]');
  input("manual-rate", "3");
  click("#target-currency");
  input("target-search", "EUR");
  el("target-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
  assert.equal(el("result-code").textContent, "EUR");
  assert.equal(el("manual-field").hidden, true);
});

test("same currency uses identity without another rate request", async () => {
  const { fetch } = await mount();
  click("#target-currency");
  input("target-search", "USD");
  el("target-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length, 1);
  assert.match(el("rate-detail").textContent, /No conversion/);
});

test("stale request cannot overwrite the latest currency selection", async () => {
  const pending = [];
  await mount(async url => {
    if (String(url).includes("currencies")) return reply(catalogue);
    return new Promise(resolve => pending.push({ url: String(url), resolve }));
  });
  click("#target-currency");
  input("target-search", "EUR");
  el("target-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  pending[1].resolve(reply(quote("USD", "EUR", 2)));
  await settle();
  pending[0].resolve(reply(quote()));
  await settle();
  assert.match(el("rate-display").textContent, /2 EUR/);
});

test("invalid salary and hours show inline errors", async () => {
  await mount();
  input("salary", "-1");
  assert.equal(el("salary").getAttribute("aria-invalid"), "true");
  input("hours-per-week", "0");
  assert.equal(el("hours-per-week").getAttribute("aria-invalid"), "true");
});

test("result announcement is delayed", async () => {
  await mount();
  input("salary", "1000");
  assert.equal(el("announcement").textContent, "");
  vi.advanceTimersByTime(650);
  assert.match(el("announcement").textContent, /Equivalent/);
});

test("empty and invalid values announce their own states", async () => {
  await mount();
  vi.advanceTimersByTime(650);
  assert.match(el("announcement").textContent, /Enter an amount/);
  input("salary", "bad");
  vi.advanceTimersByTime(650);
  assert.match(el("announcement").textContent, /unavailable/);
});

test("stale cached quote is marked and can be refreshed", async () => {
  let count = 0;
  await mount(async url => String(url).includes("currencies") ? reply(catalogue)
    : reply(++count === 1 ? { ...quote(), stale: true, max_age: 60 } : quote()));
  assert.match(el("rate-detail").textContent, /Cached rate/);
  assert.equal(el("retry-rate").hidden, false);
  click("#retry-rate");
  await settle();
  assert.equal(el("retry-rate").hidden, true);
});

test("manual mode can return to automatic quote", async () => {
  const { fetch } = await mount();
  click('[data-mode="manual"]');
  input("manual-rate", "7");
  assert.match(el("rate-display").textContent, /7 BRL/);
  click('[data-mode="auto"]');
  await settle();
  assert.match(el("rate-display").textContent, /5 BRL/);
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length, 1);
});

test("manual entry, hours and salary normalize on blur", async () => {
  await mount();
  input("salary", "1200");
  el("salary").dispatchEvent(new window.Event("blur"));
  assert.equal(el("salary").value, "1,200");
  input("hours-per-week", "37.5");
  el("hours-per-week").dispatchEvent(new window.Event("blur"));
  assert.equal(el("hours-per-week").value, "37.5");
  click('[data-mode="manual"]');
  input("manual-rate", "2.5");
  el("manual-rate").dispatchEvent(new window.Event("blur"));
  assert.equal(el("manual-rate").value, "2.5");
});

test("bad manual rate and overflow do not display a result", async () => {
  await mount();
  click('[data-mode="manual"]');
  input("manual-rate", "0");
  assert.equal(el("manual-rate").getAttribute("aria-invalid"), "true");
  input("manual-rate", "2");
  input("salary", String(Number.MAX_SAFE_INTEGER));
  assert.equal(el("salary").getAttribute("aria-invalid"), "true");
});

test("target period and payment schedule update equivalent", async () => {
  await mount();
  input("salary", "120000");
  click('#target-period-control [data-period="annual"]');
  assert.equal(el("target-salary").value, "600,000");
  el("target-thirteenth").checked = true;
  el("target-thirteenth").dispatchEvent(new window.Event("change", { bubbles: true }));
  click('#target-period-control [data-period="monthly"]');
  assert.match(el("target-salary").value, /46,153/);
  click('#target-period-control [data-period="hourly"]');
  assert.match(el("target-equivalent").textContent, /\/ month$/);
  assert.match(el("target-secondary-equivalent").textContent, /\/ year$/);
});

test("both salary fields show the other two periods below the selected one", async () => {
  await mount();
  input("salary", "120000");
  for (const [period, first, second] of [
    ["hourly", "month", "year"],
    ["monthly", "hour", "year"],
    ["annual", "hour", "month"],
  ]) {
    for (const [side, control] of [["source", "period-control"], ["target", "target-period-control"]]) {
      click(`#${control} [data-period="${period}"]`);
      assert.match(el(`${side}-equivalent`).textContent, new RegExp(`/ ${first}$`));
      assert.match(el(`${side}-secondary-equivalent`).textContent, new RegExp(`/ ${second}$`));
      assert.notEqual(el(`${side}-equivalent`).textContent[0], "—");
      assert.notEqual(el(`${side}-secondary-equivalent`).textContent[0], "—");
    }
  }
});

test("currency menu supports arrows, escape, click and empty search", async () => {
  await mount();
  click("#source-currency");
  input("source-search", "NO_MATCH");
  assert.equal(document.querySelector("#source-menu .empty-search").hidden, false);
  input("source-search", "EUR");
  el("source-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  el("source-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  el("source-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(el("source-menu").hidden, true);
  click("#source-currency");
  input("source-search", "EUR");
  click("#source-options [data-index]");
  await settle();
  assert.equal(el("input-code").textContent, "EUR");
});

test("clicking selected currency and outside closes menu", async () => {
  await mount();
  click("#source-currency");
  click("#source-currency");
  assert.equal(el("source-menu").hidden, true);
  click("#source-currency");
  document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  assert.equal(el("source-menu").hidden, true);
});

test("catalogue refresh updates an open currency menu", async () => {
  await mount();
  click("#source-currency");
  click("#retry-currencies");
  await settle();
  assert.match(el("source-options").textContent, /USD/);
});

test("visibility and focus refresh an expired quote", async () => {
  const { fetch } = await mount();
  vi.setSystemTime(Date.now() + 4_000_000);
  document.dispatchEvent(new window.Event("visibilitychange"));
  window.dispatchEvent(new window.Event("focus"));
  await settle();
  assert.ok(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length >= 2);
});

test("obsolete failed request does not replace newer result", async () => {
  const pending = [];
  await mount(async url => String(url).includes("currencies") ? reply(catalogue)
    : new Promise((resolve, reject) => pending.push({ resolve, reject })));
  click("#target-currency");
  input("target-search", "EUR");
  el("target-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  pending[1].resolve(reply(quote("USD", "EUR", 2)));
  await settle();
  pending[0].reject(new Error("late failure"));
  await settle();
  assert.match(el("rate-display").textContent, /2 EUR/);
});

test("catalogue HTTP error leaves fallback currencies available", async () => {
  await mount(async url => String(url).includes("currencies") ? fail() : reply(quote()));
  assert.equal(el("catalogue-error").hidden, false);
  click("#source-currency");
  assert.match(el("source-options").textContent, /USD/);
});

test("period cannot change while weekly hours are invalid", async () => {
  await mount();
  input("hours-per-week", "0");
  click('#period-control [data-period="monthly"]');
  assert.equal(document.querySelector('#period-control [data-period="annual"]').getAttribute("aria-pressed"), "true");
});

test("selection of the current currency does not fetch a rate", async () => {
  const { fetch } = await mount();
  click("#source-currency");
  input("source-search", "USD");
  el("source-search").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length, 1);
});

test("switching to manual cancels a pending rate request", async () => {
  const pending = [];
  await mount(async url => String(url).includes("currencies") ? reply(catalogue)
    : new Promise(resolve => pending.push(resolve)));
  click('[data-mode="manual"]');
  input("manual-rate", "4");
  pending[0](reply(quote()));
  await settle();
  assert.match(el("rate-display").textContent, /4 BRL/);
});

test("focus before cache expiry avoids another request", async () => {
  const { fetch } = await mount();
  window.dispatchEvent(new window.Event("focus"));
  await settle();
  assert.equal(fetch.mock.calls.filter(([url]) => String(url).includes("/api/rate")).length, 1);
});

test("switching language reformats the manual rate", async () => {
  await mount();
  click('[data-mode="manual"]');
  input("manual-rate", "2.5");
  change("language", "pt");
  assert.equal(el("manual-rate").value, "2,5");
});

test("saved language preference is restored", async () => {
  await mount(undefined, dom => dom.window.localStorage.setItem("language", "pt"));
  assert.equal(document.documentElement.lang, "pt-BR");
});

test("Portuguese browser language selects Portuguese initially", async () => {
  await mount(undefined, dom => Object.defineProperty(dom.window.navigator, "language", { value: "pt-BR" }));
  assert.equal(document.documentElement.lang, "pt-BR");
});
