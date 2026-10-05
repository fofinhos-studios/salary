import type { TaxRules } from "./contracts";

export type Regime = "simples" | "presumido";
export type Inputs = {
  cltMonthly: number; variableMonthly: number; plrAnnual: number;
  mealDaily: number; mealDays: number; healthMonthly: number; cltOtherBenefitsMonthly: number;
  cltDeductionsAnnual: number; fgtsShare: number;
  pjMonthly: number; pjPaidVacationDays: number; pjVacationDays: number;
  pjBenefitsMonthly: number; accountantMonthly: number; businessAnnual: number;
  insuranceMonthly: number; proLaboreMonthly: number; previousRevenue: number;
  previousPayroll: number; issRate: number; regime: Regime; exportServices: boolean;
  foreignFeeRate: number; foreignFeeFixed: number;
  dependents: number; educationAnnual: number; medicalAnnual: number;
  pensionAnnual: number; pgblAnnual: number; otherTaxableAnnual: number;
  otherExemptAnnual: number;
};
export type Result = {
  gross: number; benefits: number; payrollTax: number; incomeTax: number;
  corporateTax: number; expenses: number; fgts: number; cash: number;
  adjustedCash: number; package: number; annualAdjustment: number;
  plrTax: number; regime: string; factorR: number | null;
  dividendWithholding: number; warnings: string[];
};
export type Comparison = { clt: Result; pj: Result; winner: "clt" | "pj" | "tie"; delta: number; percent: number | null };

const cents = (n: number) => Math.round((n + 1e-9) * 100);
const money = (n: number) => cents(n) / 100;
const pct = (n: number, rate: number) => money(n * rate);
const sum = (rows: number[]) => money(rows.reduce((a, b) => a + b, 0));
const SIMPLES_III = [[180000, .06, 0], [360000, .112, 9360], [720000, .135, 17640],
  [1800000, .16, 35640], [3600000, .21, 125640], [4800000, .33, 648000]] as const;
const SIMPLES_V = [[180000, .155, 0], [360000, .18, 4500], [720000, .195, 9900],
  [1800000, .205, 17100], [3600000, .23, 62100], [4800000, .305, 540000]] as const;
// Cofins, PIS/Pasep, ISS and the PIS/Cofins share of ISS above the 5% ceiling.
const EXPORT_III = [[.1282, .0278, .335, 0], [.1405, .0305, .32, 0],
  [.1364, .0296, .325, 0], [.1364, .0296, .325, 0],
  [.1282, .0278, .335, .2346], [.1603, .0347, 0, 0]] as const;
const EXPORT_V = [[.141, .0305, .14, 0], [.141, .0305, .17, 0],
  [.1492, .0323, .19, 0], [.1574, .0341, .21, 0],
  [.141, .0305, .235, .2242], [.1644, .0356, 0, 0]] as const;

export function progressive(base: number, table: [number, number, number][]): number {
  if (base <= 0) return 0;
  const row = table.find(([limit]) => base <= limit) ?? table.at(-1);
  return row ? Math.max(0, money(base * row[1] - row[2])) : 0;
}

export function inssEmployee(base: number, rules: TaxRules): number {
  let previous = 0, tax = 0;
  for (const [limit, rate] of rules.inss_employee) {
    tax += Math.max(0, Math.min(base, limit) - previous) * rate;
    if (base <= limit) break;
    previous = limit;
  }
  return money(tax);
}

export function irMonthly(taxable: number, deductions: number, rules: TaxRules): number {
  const base = Math.max(0, taxable - Math.max(deductions, rules.simplified_monthly));
  const ordinary = progressive(base, rules.ir_monthly);
  if (taxable <= 5000) return 0;
  if (taxable <= 7350) return Math.max(0, money(ordinary - Math.min(ordinary, 978.62 - .133145 * taxable)));
  return ordinary;
}

export function irAnnual(taxable: number, legalDeductions: number, rules: TaxRules): number {
  const base = Math.max(0, taxable - Math.max(legalDeductions, Math.min(taxable * .2, rules.simplified_annual)));
  const ordinary = progressive(base, rules.ir_annual);
  if (taxable <= 60000) return 0;
  if (taxable <= 88200) return Math.max(0, money(ordinary - Math.min(ordinary, 8429.73 - .095575 * taxable)));
  return ordinary;
}

function annualIncrement(offerTaxable: number, offerDeduction: number, input: Inputs, rules: TaxRules): number {
  const commonDeduction = (taxable: number) => Math.min(input.educationAnnual, rules.education_annual)
    + input.medicalAnnual + input.pensionAnnual + Math.min(input.pgblAnnual, taxable * .12)
    + input.dependents * rules.dependent_annual;
  const total = input.otherTaxableAnnual + offerTaxable;
  return money(irAnnual(total, commonDeduction(total) + offerDeduction, rules)
    - irAnnual(input.otherTaxableAnnual, commonDeduction(input.otherTaxableAnnual), rules));
}

function clt(input: Inputs, rules: TaxRules): Result {
  const monthly = input.cltMonthly + input.variableMonthly;
  const vacationThird = money(monthly / 3);
  const thirteenth = monthly;
  const gross = sum([monthly * 12, vacationThird, thirteenth, input.plrAnnual]);
  const inssMonthly = inssEmployee(monthly, rules);
  const inss13 = inssEmployee(thirteenth, rules);
  const vacationInss = money(inssEmployee(monthly + vacationThird, rules) - inssMonthly);
  const payrollTax = sum([inssMonthly * 12, inss13, vacationInss]);
  const withhold = sum([
    irMonthly(monthly, inssMonthly + input.dependents * rules.dependent_monthly, rules) * 11,
    irMonthly(monthly + vacationThird, inssEmployee(monthly + vacationThird, rules)
      + input.dependents * rules.dependent_monthly, rules),
    irMonthly(thirteenth, inss13 + input.dependents * rules.dependent_monthly, rules),
  ]);
  const plrTax = progressive(input.plrAnnual, rules.plr);
  const annualDue = annualIncrement(monthly * 12 + vacationThird,
    inssMonthly * 12 + vacationInss, input, rules);
  const incomeTax = sum([annualDue, irMonthly(thirteenth, inss13
    + input.dependents * rules.dependent_monthly, rules), plrTax]);
  const annualAdjustment = money(annualDue - (withhold - irMonthly(thirteenth, inss13
    + input.dependents * rules.dependent_monthly, rules)));
  const benefits = sum([input.mealDaily * input.mealDays * 12,
    (input.healthMonthly + input.cltOtherBenefitsMonthly) * 12]);
  const fgts = pct(monthly * 13 + vacationThird, .08);
  const expenses = input.cltDeductionsAnnual;
  const cash = money(gross - payrollTax - withhold - plrTax - expenses);
  const adjustedCash = money(gross - payrollTax - incomeTax - expenses);
  return { gross, benefits, payrollTax, incomeTax, corporateTax: 0, expenses,
    fgts, cash, adjustedCash, package: money(adjustedCash + benefits + fgts * input.fgtsShare),
    annualAdjustment, plrTax, regime: "clt", factorR: null, dividendWithholding: 0, warnings: [] };
}

function pj(input: Inputs, rules: TaxRules): Result {
  const warnings: string[] = [];
  const annualMonths = 12 - (input.pjVacationDays - input.pjPaidVacationDays) / 30;
  const gross = money(input.pjMonthly * annualMonths);
  const proLabore = input.proLaboreMonthly || Math.max(rules.minimum_wage, input.pjMonthly * .28);
  const payrollTax = pct(Math.min(proLabore, rules.inss_ceiling), .11) * 12;
  const proLaboreTaxMonthly = irMonthly(proLabore,
    payrollTax / 12 + input.dependents * rules.dependent_monthly, rules);
  let corporateTax = 0, factorR: number | null = null, annex: string = input.regime;
  const monthlyRevenue = gross / 12;
  if (input.regime === "simples") {
    const rbt12 = input.previousRevenue || gross;
    const payroll12 = input.previousPayroll || proLabore * 12;
    factorR = rbt12 > 0 ? payroll12 / rbt12 : null;
    if (rbt12 > 4800000) warnings.push("simples_limit");
    if (rbt12 > 3600000 && !input.exportServices) warnings.push("simples_sublimit");
    const table = factorR !== null && factorR >= .28 ? SIMPLES_III : SIMPLES_V;
    annex = table === SIMPLES_III ? "III" : "V";
    const selected = table.findIndex(([limit]) => rbt12 <= limit);
    const bracket = selected < 0 ? table.length - 1 : selected;
    const [, nominal, deduction] = table[bracket] ?? table.at(-1)!;
    const effective = rbt12 > 0 ? (rbt12 * nominal - deduction) / rbt12 : nominal;
    if (input.exportServices) {
      const [cofins, pis, iss, redistributed] = (annex === "III" ? EXPORT_III : EXPORT_V)[bracket]!;
      const issNominal = effective * iss;
      const excessIss = Math.max(0, issNominal - .05);
      const exempt = effective * (cofins + pis) + Math.min(issNominal, .05)
        + excessIss * redistributed;
      corporateTax = pct(gross, Math.max(0, effective - exempt));
      warnings.push("export_eligibility");
    } else corporateTax = pct(gross, effective);
    if (!input.previousRevenue) warnings.push("projected_rbt12");
  } else {
    const quarterly = gross / 4;
    const presumed = quarterly * .32;
    const irpj = pct(presumed, .15) + pct(Math.max(0, presumed - 60000), .10);
    const csll = pct(presumed, .09);
    const contributions = input.exportServices ? 0 : pct(gross, .0365);
    const iss = input.exportServices ? 0 : pct(gross, input.issRate);
    const employerInss = pct(proLabore * 12, .20);
    corporateTax = sum([(irpj + csll) * 4, contributions, iss, employerInss]);
    if (input.exportServices) warnings.push("export_eligibility");
    if (!input.exportServices && input.issRate === 0) warnings.push("iss_required");
    if (gross > 5000000) warnings.push("presumed_high_revenue");
  }
  const fees = sum([pct(gross, input.foreignFeeRate), input.foreignFeeFixed * 12]);
  const expenses = sum([input.accountantMonthly * 12, input.businessAnnual,
    input.insuranceMonthly * 12, fees]);
  const distributable = Math.max(0, money(gross - corporateTax - proLabore * 12 - expenses));
  if (gross - corporateTax - proLabore * 12 - expenses < 0) warnings.push("company_deficit");
  const dividendWithholding = distributable / 12 > 50000 ? pct(distributable, .10) : 0;
  const annualDue = annualIncrement(proLabore * 12, payrollTax, input, rules);
  const withhold = proLaboreTaxMonthly * 12;
  const annualAdjustment = money(annualDue - withhold);
  const incomeTax = sum([annualDue, dividendWithholding]);
  const benefits = input.pjBenefitsMonthly * 12;
  const cash = money(gross - corporateTax - payrollTax - withhold
    - dividendWithholding - expenses);
  const adjustedCash = money(gross - corporateTax - payrollTax - incomeTax - expenses);
  if (input.otherTaxableAnnual + input.otherExemptAnnual + proLabore * 12 + distributable > 600000)
    warnings.push("high_income_review");
  return { gross, benefits, payrollTax, incomeTax, corporateTax, expenses,
    fgts: 0, cash, adjustedCash, package: money(adjustedCash + benefits),
    annualAdjustment, plrTax: 0, regime: annex, factorR, dividendWithholding, warnings };
}

export function compareBrazil(input: Inputs, rules: TaxRules): Comparison | null {
  const values = Object.values(input).filter((value): value is number => typeof value === "number");
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
      || input.fgtsShare > 1 || input.issRate > .05 || input.foreignFeeRate > 1
      || input.pjVacationDays > 365 || input.pjPaidVacationDays > input.pjVacationDays
      || !Number.isInteger(input.dependents) || !Number.isInteger(input.mealDays)) return null;
  const a = clt(input, rules), b = pj(input, rules);
  if ([...Object.values(a), ...Object.values(b)].some(value => typeof value === "number" && !Number.isFinite(value))) return null;
  const delta = money(b.package - a.package);
  return { clt: a, pj: b, delta, winner: delta > 0 ? "pj" : delta < 0 ? "clt" : "tie",
    percent: Math.min(a.package, b.package) > 0
      ? money(Math.abs(delta) / Math.min(a.package, b.package) * 100) : null };
}
