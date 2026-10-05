// Mirror of the public models in models.py; shared cases guard the wire contract.

import * as z from "zod/mini";

const code = z.string().check(z.regex(/^[A-Z]{3}$/));
const referenceDate = z.string().check(z.refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1 && parsed.toISOString().slice(0, 10) === value;
}));
const positiveRate = z.number().check(z.refine(value => Number.isFinite(value) && value > 0));

export const currencySchema = z.strictObject({ code, name: z.string().check(z.minLength(1)) });
export const currenciesResponseSchema = z.strictObject({
  currencies: z.array(currencySchema).check(z.minLength(1)),
});
export const rateSchema = z.strictObject({
  base: code,
  quote: code,
  rate: positiveRate,
  date: z.nullable(referenceDate),
  source: z.enum(["Frankfurter", "BCB", "identity"]),
  stale: z.boolean(),
  max_age: z.int().check(z.nonnegative()),
}).check(z.refine(rate => rate.source === "identity"
  ? rate.base === rate.quote && rate.rate === 1 && rate.date === null && !rate.stale
  : rate.date !== null));
export const errorResponseSchema = z.strictObject({
  error: z.enum(["not_found", "method_not_allowed", "invalid_currency", "provider_unavailable", "rate_unavailable", "rules_unavailable"]),
});

const bracket2 = z.tuple([z.number(), z.number()]);
const bracket3 = z.tuple([z.number(), z.number(), z.number()]);
export const taxRulesSchema = z.strictObject({
  year: z.literal(2026), valid_from: z.string(), checked_at: z.string(),
  source: z.enum(["official_snapshot", "official_snapshot_inss_verified"]),
  inss_employee: z.array(bracket2), inss_ceiling: z.number(), minimum_wage: z.number(),
  ir_monthly: z.array(bracket3), ir_annual: z.array(bracket3), plr: z.array(bracket3),
  dependent_monthly: z.number(), dependent_annual: z.number(),
  simplified_monthly: z.number(), simplified_annual: z.number(), education_annual: z.number(),
  sources: z.record(z.string(), z.string()),
});

export type Currency = z.infer<typeof currencySchema>;
export type Rate = z.infer<typeof rateSchema>;
export type TaxRules = z.infer<typeof taxRulesSchema>;
