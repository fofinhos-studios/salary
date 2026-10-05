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

export function calculate(value, period, sourcePayments, targetPayments, rate) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(rate) || rate <= 0) return null;
  if (![12, 13].includes(sourcePayments) || ![12, 13].includes(targetPayments)) return null;
  if (!["monthly", "annual"].includes(period)) return null;
  const sourceAnnual = period === "annual" ? value : value * sourcePayments;
  const annual = sourceAnnual * rate;
  const monthly = annual / targetPayments;
  if (![sourceAnnual, annual, monthly].every(n => Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER)) return null;
  return { sourceAnnual, annual, monthly };
}

export function changePeriod(value, current, next, payments) {
  if (value === null || current === next) return value;
  return next === "annual" ? value * payments : value / payments;
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
