export type Period = "hourly" | "monthly" | "annual";
export type Payments = 12 | 13;
export type Side = "source" | "target";
export type Calculation = { sourceAnnual: number; annual: number; monthly: number; hourly: number };

export function parseAmount(text: string, locale: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const portuguese = locale.startsWith("pt");
  const pattern = portuguese
    ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d*)?$|^,\d+$/
    : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$|^\.\d+$/;
  if (!pattern.test(value)) return null;
  const number = Number(portuguese ? value.replaceAll(".", "").replace(",", ".") : value.replaceAll(",", ""));
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

export function formatSalaryText(text: string, cursor: number, locale: string): { text: string; cursor: number; value: number } | null {
  const group = locale.startsWith("pt") ? "." : ",";
  const decimal = locale.startsWith("pt") ? "," : ".";
  const ungrouped = text.replaceAll(group, "");
  const value = parseAmount(ungrouped, locale);
  if (value === null) return null;
  const [whole = "", fraction] = ungrouped.split(decimal);
  const formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (fraction === undefined ? "" : decimal + fraction);
  const before = text.slice(0, cursor).replaceAll(group, "").length;
  let position = 0, characters = 0;
  while (characters < before && position < formatted.length) if (formatted[position++] !== group) characters++;
  return { text: formatted, cursor: position, value };
}

export function calculate(value: number | null, period: string, sourcePayments: number, targetPayments: number, rate: number | null, hoursPerWeek: number | null = 40): Calculation | null {
  if (value === null || !Number.isFinite(value) || value < 0 || rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  if (![12, 13].includes(sourcePayments) || ![12, 13].includes(targetPayments)) return null;
  if (!["hourly", "monthly", "annual"].includes(period)) return null;
  if (hoursPerWeek === null || !Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0) return null;
  const annualHours = hoursPerWeek * 52;
  if (!Number.isFinite(annualHours) || annualHours > Number.MAX_SAFE_INTEGER) return null;
  const sourceAnnual = period === "annual" ? value : period === "monthly" ? value * sourcePayments : value * annualHours;
  const annual = sourceAnnual * rate;
  const monthly = annual / targetPayments;
  const hourly = annual / annualHours;
  if (![sourceAnnual, annual, monthly, hourly].every(n => Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER)) return null;
  return { sourceAnnual, annual, monthly, hourly };
}

export function changePeriod(value: number | null, current: Period, next: Period, payments: Payments, hoursPerWeek = 40): number | null {
  if (value === null || current === next) return value;
  const annualHours = hoursPerWeek * 52;
  const annual = current === "annual" ? value : current === "monthly" ? value * payments : value * annualHours;
  const converted = next === "annual" ? annual : next === "monthly" ? annual / payments : annual / annualHours;
  return Number.isFinite(converted) && converted <= Number.MAX_SAFE_INTEGER ? converted : null;
}

export function money(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" }).format(value);
}

export function amount(value: number, currency: string, locale: string): string {
  const { maximumFractionDigits } = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions();
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function searchKey(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
