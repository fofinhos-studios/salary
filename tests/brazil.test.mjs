import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { mountBrazil } from "../frontend/brazil.ts";

const rules = {
  year: 2026, valid_from: "2026-01-01", checked_at: "2026-10-05", source: "official_snapshot",
  inss_employee: [[1621,.075],[2902.84,.09],[4354.27,.12],[8475.55,.14]],
  inss_ceiling: 8475.55, minimum_wage: 1621,
  ir_monthly: [[2428.8,0,0],[2826.65,.075,182.16],[3751.05,.15,394.16],[4664.68,.225,675.49],[1e15,.275,908.73]],
  ir_annual: [[29145.6,0,0],[33919.8,.075,2185.92],[45012.6,.15,4729.91],[55976.16,.225,8105.85],[1e15,.275,10904.66]],
  plr: [[8214.4,0,0],[9922.28,.075,616.08],[13167,.15,1360.25],[16380.38,.225,2347.78],[1e15,.275,3166.8]],
  dependent_monthly: 189.59, dependent_annual: 2275.08,
  simplified_monthly: 607.20, simplified_annual: 17640, education_annual: 3561.50, sources: {},
};
const el = id => document.getElementById(id);
const enter = (id, value) => { el(id).value = value; el(id).dispatchEvent(new Event("input", { bubbles: true })); };
const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new Event("change", { bubbles: true })); };
const rateMode = (side, value) => {
  const radio = document.querySelector(`[data-rate-mode="${side}"][value="${value}"]`);
  radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true }));
};
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function setup(fetcher = async url => ({ ok: true, json: async () =>
  String(url).includes("tax-rules") ? rules : {
    base: "USD", quote: "BRL", rate: 5, date: "2026-10-02", source: "BCB", stale: false, max_age: 3600,
  } })) {
  document.body.innerHTML = '<div id="brazil-panel"></div>';
  let language = "en";
  const fetch = vi.fn(fetcher);
  vi.stubGlobal("fetch", fetch);
  const page = mountBrazil(() => language, () => [{ code: "USD", name: "US Dollar" }]);
  await settle();
  return { page, fetch, setLanguage: value => { language = value; page.setLanguage(); } };
}

test("CLT vs PJ report updates with currency, period and language while retaining inputs", async () => {
  const { setLanguage } = await setup();
  enter("br-cltMonthly", "10000");
  enter("br-pjMonthly", "14000");
  assert.match(el("br-result").textContent, /Higher package: PJ/);
  assert.ok(el("br-result").querySelector("math"));
  change("br-pj-period", "annual");
  assert.equal(el("br-pjMonthly").value, "168,000");
  change("br-pj-period", "monthly");
  change("br-pj-currency", "USD");
  await settle();
  enter("br-pjMonthly", "3000");
  assert.match(el("br-pj-source").textContent, /BCB/);
  assert.match(el("br-result").textContent, /Higher package: PJ/);
  setLanguage("pt");
  assert.equal(el("br-pjMonthly").value, "3.000");
  assert.match(el("br-result").textContent, /Maior pacote: PJ/);
  el("br-result").querySelector("[data-help='package']").click();
  assert.equal(el("br-tip-package").hidden, false);
  assert.match(el("br-tip-package").textContent, /Caixa ajustado/);
});

test("manual exchange rate, hourly entry and required municipal tax update live", async () => {
  const { page, fetch } = await setup();
  enter("br-cltMonthly", "10000");
  enter("br-pjMonthly", "14000");
  change("br-regime", "presumido");
  assert.match(el("br-result").textContent, /Enter the applicable municipal ISS rate/);
  enter("br-issRate", "5");
  assert.match(el("br-result").textContent, /Higher package/);
  change("br-pj-period", "hourly");
  assert.ok(Number(el("br-pjMonthly").value) > 0);
  enter("br-pj-hours", "20");
  enter("br-pjMonthly", "100");
  assert.match(el("br-result").textContent, /Higher package/);
  change("br-pj-currency", "USD");
  await settle();
  assert.match(el("br-pj-source").textContent, /BCB/);
  rateMode("pj", "manual");
  assert.equal(el("br-pj-manual").hidden, false);
  enter("br-pj-manual", "2");
  assert.match(el("br-pj-source").textContent, /Manual rate/);
  assert.match(el("br-result").textContent, /Higher package/);
  enter("br-pj-manual", "bad");
  assert.match(el("br-result").textContent, /Complete required tax/);
  rateMode("pj", "auto");
  await settle();
  assert.ok(fetch.mock.calls.some(([url]) => String(url).includes("/api/br/rate")));
  page.activate();
  await settle();
});

test("warnings, explanations and tax-rule errors are explicit", async () => {
  const { page } = await setup();
  enter("br-cltMonthly", "10000");
  enter("br-pjMonthly", "14000");
  change("br-export", "true");
  assert.match(el("br-result").textContent, /Export tax treatment/);
  assert.ok(el("br-result").querySelector(".br-head"));
  el("br-result").querySelector(".br-alert").click();
  assert.equal(el("br-tip-warning-0").hidden, false);
  el("brazil-panel").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(el("br-tip-warning-0").hidden, true);
  change("br-export", "false");
  enter("br-otherExemptAnnual", "1000000");
  assert.match(el("br-result").textContent, /High-income minimum tax/);
  enter("br-otherExemptAnnual", "0");
  enter("br-pjVacationDays", "30");
  enter("br-pjPaidVacationDays", "15");
  assert.match(el("br-result").textContent, /Higher package/);
  page.setLanguage();
  assert.equal(el("br-pjVacationDays").value, "30");
});

test("rule endpoint failure is shown and can recover on activation", async () => {
  let fails = true;
  const { page } = await setup(async url => String(url).includes("tax-rules")
    ? fails ? { ok: false } : { ok: true, json: async () => rules }
    : { ok: false });
  enter("br-cltMonthly", "10000");
  enter("br-pjMonthly", "14000");
  assert.match(el("br-result").textContent, /Rules unavailable/);
  fails = false;
  page.activate();
  await settle();
  assert.match(el("br-result").textContent, /Higher package/);
});

test("invalid rates never produce a winner and stale reference data is labeled", async () => {
  let valid = false;
  const { page } = await setup(async url => String(url).includes("tax-rules")
    ? { ok: true, json: async () => rules }
    : { ok: true, json: async () => valid
      ? { base: "USD", quote: "BRL", rate: 5, date: "2026-10-02", source: "BCB", stale: true, max_age: 3600 }
      : { base: "EUR", quote: "BRL", rate: 5, date: "2026-10-02", source: "BCB", stale: false, max_age: 3600 } });
  enter("br-cltMonthly", "10000");
  enter("br-pjMonthly", "3000");
  change("br-pj-currency", "USD");
  await settle();
  assert.match(el("br-result").textContent, /Complete required tax/);
  valid = true;
  page.activate();
  await settle();
  assert.match(el("br-pj-source").textContent, /previous quote/);
  assert.match(el("br-result").textContent, /Higher package/);
  rateMode("pj", "manual");
  enter("br-pj-manual", "0");
  assert.match(el("br-result").textContent, /Complete required tax/);
  enter("br-pj-manual", "5");
  assert.match(el("br-result").textContent, /Higher package/);
});

test("unavailable tax combinations and edited annual inputs remain explainable", async () => {
  const { setLanguage } = await setup();
  enter("br-cltMonthly", "10000");
  enter("br-pjMonthly", "14000");
  change("br-clt-period", "annual");
  assert.equal(el("br-cltMonthly").value, "120,000");
  enter("br-cltMonthly", "120000");
  change("br-clt-period", "hourly");
  enter("br-clt-hours", "40");
  assert.match(el("br-result").textContent, /Higher package/);
  enter("br-issRate", "5");
  change("br-regime", "presumido");
  change("br-export", "true");
  assert.match(el("br-result").textContent, /Higher package/);
  enter("br-pjMonthly", "500000");
  assert.match(el("br-result").textContent, /presumption adjustment/);
  change("br-export", "false");
  change("br-regime", "simples");
  enter("br-previousRevenue", "5000000");
  assert.match(el("br-result").textContent, /Simples annual limit/);
  setLanguage("pt");
  assert.match(el("br-result").textContent, /limite anual do Simples/);
  el("brazil-panel").querySelector("[data-help='br-fgts']").click();
  assert.equal(el("br-tip-br-fgts").hidden, false);
});
