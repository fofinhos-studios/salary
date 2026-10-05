export function parseAmount(text, locale) {
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

export function calculate(value, period, sourcePayments, targetPayments, rate, hoursPerWeek = 40) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(rate) || rate <= 0) return null;
  if (![12, 13].includes(sourcePayments) || ![12, 13].includes(targetPayments)) return null;
  if (!["hourly", "monthly", "annual"].includes(period)) return null;
  const annualHours = hoursPerWeek * 52;
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0 || !Number.isFinite(annualHours) || annualHours > Number.MAX_SAFE_INTEGER) return null;
  const sourceAnnual = period === "annual" ? value : period === "monthly" ? value * sourcePayments : value * annualHours;
  const annual = sourceAnnual * rate;
  const monthly = annual / targetPayments;
  const hourly = annual / annualHours;
  if (![sourceAnnual, annual, monthly, hourly].every(n => Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER)) return null;
  return { sourceAnnual, annual, monthly, hourly };
}

export function changePeriod(value, current, next, payments, hoursPerWeek = 40) {
  if (value === null || current === next) return value;
  const annualHours = hoursPerWeek * 52;
  const annual = current === "annual" ? value : current === "monthly" ? value * payments : value * annualHours;
  const converted = next === "annual" ? annual : next === "monthly" ? annual / payments : annual / annualHours;
  return Number.isFinite(converted) && converted <= Number.MAX_SAFE_INTEGER ? converted : null;
}

export function money(value, currency, locale) {
  return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" }).format(value);
}

export function amount(value, currency, locale) {
  const { maximumFractionDigits } = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions();
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function searchKey(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
