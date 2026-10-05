import assert from "node:assert/strict";
import { test } from "vitest";
import { compareBrazil, inssEmployee, irMonthly, irAnnual, progressive } from "../frontend/brCore.ts";

const rules = {
  year: 2026, valid_from: "2026-01-01", checked_at: "2026-10-05", source: "official_snapshot",
  inss_employee: [[1621,.075],[2902.84,.09],[4354.27,.12],[8475.55,.14]],
  inss_ceiling: 8475.55, minimum_wage: 1621,
  ir_monthly: [[2428.8,0,0],[2826.65,.075,182.16],[3751.05,.15,394.16],[4664.68,.225,675.49],[1e15,.275,908.73]],
  ir_annual: [[29145.6,0,0],[33919.8,.075,2185.92],[45012.6,.15,4729.91],[55976.16,.225,8105.85],[1e15,.275,10904.66]],
  plr: [[8214.4,0,0],[9922.28,.075,616.08],[13167,.15,1360.25],[16380.38,.225,2347.78],[1e15,.275,3166.8]],
  dependent_monthly: 189.59, dependent_annual: 2275.08,
  simplified_monthly: 607.20, simplified_annual: 17640,
  education_annual: 3561.50, sources: {},
};
const base = {
  cltMonthly: 10000, variableMonthly: 0, plrAnnual: 0, mealDaily: 0, mealDays: 21,
  healthMonthly: 0, cltOtherBenefitsMonthly: 0, cltDeductionsAnnual: 0, fgtsShare: .5,
  pjMonthly: 14000, pjPaidVacationDays: 0, pjVacationDays: 0, pjBenefitsMonthly: 0,
  accountantMonthly: 0, businessAnnual: 0, insuranceMonthly: 0, proLaboreMonthly: 3920,
  previousRevenue: 168000, previousPayroll: 47040, issRate: 0, regime: "simples",
  exportServices: false, foreignFeeRate: 0, foreignFeeFixed: 0, dependents: 0,
  educationAnnual: 0, medicalAnnual: 0, pensionAnnual: 0, pgblAnnual: 0,
  otherTaxableAnnual: 0, otherExemptAnnual: 0,
};

test("2026 payroll and income thresholds", () => {
  assert.equal(inssEmployee(1621, rules), 121.58);
  assert.equal(inssEmployee(100000, rules), inssEmployee(8475.55, rules));
  assert.equal(irMonthly(5000, 0, rules), 0);
  assert.ok(irMonthly(7350, 0, rules) < irMonthly(7351, 0, rules));
  assert.equal(irAnnual(60000, 0, rules), 0);
});

test("CLT vacation is not double counted, while PLR and FGTS are distinct", () => {
  const result = compareBrazil(base, rules);
  assert.ok(result);
  assert.equal(result.clt.gross, 133333.33);
  assert.equal(result.clt.fgts, Math.round((10000 * 13 + 10000 / 3) * .08 * 100) / 100);
  const withPlr = compareBrazil({ ...base, plrAnnual: 20000 }, rules);
  assert.ok(withPlr.clt.gross > result.clt.gross);
  assert.ok(withPlr.clt.plrTax > 0);
});

test("Simples factor R boundary changes annex and FGTS share changes winner value", () => {
  const iii = compareBrazil(base, rules);
  const v = compareBrazil({ ...base, previousPayroll: 47039.99 }, rules);
  assert.equal(iii.pj.regime, "III");
  assert.equal(v.pj.regime, "V");
  assert.ok(v.pj.corporateTax > iii.pj.corporateTax);
  const zeroFgts = compareBrazil({ ...base, fgtsShare: 0 }, rules);
  assert.ok(Math.abs(iii.clt.package - zeroFgts.clt.package - iii.clt.fgts * .5) < .01);
});

test("presumed profit taxes and missing ISS warning", () => {
  const result = compareBrazil({ ...base, regime: "presumido", issRate: .05 }, rules);
  assert.equal(result.pj.regime, "presumido");
  assert.ok(result.pj.corporateTax > 0);
  assert.deepEqual(result.pj.warnings, []);
  assert.ok(compareBrazil({ ...base, regime: "presumido" }, rules).pj.warnings.includes("iss_required"));
});

test("the report blocks invalid inputs and preserves the right winner direction", () => {
  for (const change of [
    { fgtsShare: 1.1 }, { issRate: .051 }, { foreignFeeRate: 1.1 },
    { pjVacationDays: 366 }, { pjPaidVacationDays: 31, pjVacationDays: 30 },
    { dependents: 1.5 }, { mealDays: 20.5 }, { cltMonthly: -1 },
    { pjMonthly: Number.POSITIVE_INFINITY },
  ]) assert.equal(compareBrazil({ ...base, ...change }, rules), null);
  const cltWins = compareBrazil({ ...base, pjMonthly: 5000 }, rules);
  assert.equal(cltWins.winner, "clt");
  assert.ok(cltWins.percent > 0 && cltWins.delta < 0);
  const tied = compareBrazil({ ...base, cltMonthly: 0, pjMonthly: 0 }, rules);
  assert.equal(tied.percent, null);
});

test("unsupported fiscal boundaries produce specific warnings instead of false certainty", () => {
  const projected = compareBrazil({ ...base, previousRevenue: 0 }, rules);
  assert.ok(projected.pj.warnings.includes("projected_rbt12"));
  const tooLarge = compareBrazil({ ...base, previousRevenue: 4800001 }, rules);
  assert.ok(tooLarge.pj.warnings.includes("simples_limit"));
  const exported = compareBrazil({ ...base, exportServices: true }, rules);
  assert.ok(exported.pj.warnings.includes("export_eligibility"));
  assert.ok(exported.pj.corporateTax < projected.pj.corporateTax);
  const deficit = compareBrazil({ ...base, proLaboreMonthly: 20000 }, rules);
  assert.ok(deficit.pj.warnings.includes("company_deficit"));
  const highIncome = compareBrazil({ ...base, otherExemptAnnual: 600000 }, rules);
  assert.ok(highIncome.pj.warnings.includes("high_income_review"));
  const highPresumed = compareBrazil({ ...base, regime: "presumido",
    pjMonthly: 450000, issRate: .05 }, rules);
  assert.ok(highPresumed.pj.warnings.includes("presumed_high_revenue"));
});

test("annual deductions use the legal PGBL cap and never turn tax negative", () => {
  const capped = compareBrazil({ ...base, pgblAnnual: 1_000_000 }, rules);
  const legal = compareBrazil({ ...base, pgblAnnual: 16000 }, rules);
  assert.equal(capped.clt.incomeTax, legal.clt.incomeTax);
  assert.ok(capped.pj.incomeTax >= 0);
});

test("tax functions handle zero, partial brackets and the annual reduction ramp", () => {
  assert.equal(progressive(0, rules.ir_monthly), 0);
  assert.equal(progressive(1000, rules.ir_monthly), 0);
  assert.equal(inssEmployee(0, rules), 0);
  assert.ok(inssEmployee(2500, rules) > inssEmployee(1621, rules));
  assert.ok(irMonthly(6000, 0, rules) > 0);
  assert.ok(irAnnual(70000, 0, rules) > 0);
  assert.ok(irAnnual(90000, 0, rules) > irAnnual(70000, 0, rules));
});

test("qualifying Simples exports remove only the Annex III/V tax shares", () => {
  const iii = compareBrazil({ ...base, exportServices: true }, rules);
  const v = compareBrazil({ ...base, previousPayroll: 47039.99, exportServices: true }, rules);
  assert.equal(iii.pj.corporateTax, 5130.72);
  assert.equal(v.pj.corporateTax, 17928.54);
  assert.ok(v.pj.corporateTax > iii.pj.corporateTax);
});
