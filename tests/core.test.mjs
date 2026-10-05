import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { amount, calculate, changePeriod, money, parseAmount, searchKey } from "../static/core.mjs";

test("annual and monthly inputs preserve the annual total across all 12/13 combinations", () => {
  for (const sourcePayments of [12, 13]) {
    for (const targetPayments of [12, 13]) {
      const annual = calculate(120000, "annual", sourcePayments, targetPayments, 5);
      const monthly = calculate(120000 / sourcePayments, "monthly", sourcePayments, targetPayments, 5);
      assert.equal(annual.annual, 600000);
      assert.equal(annual.monthly, 600000 / targetPayments);
      assert.ok(Math.abs(monthly.annual - annual.annual) < 1e-8);
      assert.ok(Math.abs(monthly.monthly - annual.monthly) < 1e-8);
    }
  }
  assert.equal(amount(calculate(120000, "annual", 12, 13, 5).monthly, "BRL", "pt-BR"), "46.153,85");
});

test("switching periods keeps full precision instead of reusing formatted values", () => {
  let value = 120000;
  for (let i = 0; i < 100; i++) {
    value = changePeriod(value, "annual", "monthly", 13);
    value = changePeriod(value, "monthly", "annual", 13);
  }
  assert.ok(Math.abs(value - 120000) < 1e-8);
  assert.equal(changePeriod(null, "annual", "monthly", 12), null);
});

test("manual rates, identity rates and zero salary", () => {
  assert.deepEqual(calculate(1000, "monthly", 13, 12, 2.5), { sourceAnnual: 13000, annual: 32500, monthly: 32500 / 12 });
  assert.equal(calculate(1000, "monthly", 12, 12, 1).monthly, 1000);
  assert.deepEqual(calculate(0, "annual", 12, 13, 5), { sourceAnnual: 0, annual: 0, monthly: 0 });
});

test("locale parsing accepts decimals and grouping without guessing ambiguous inputs", () => {
  for (const [text, locale, expected] of [
    ["120.000,50", "pt-BR", 120000.5], ["120,000.50", "en-US", 120000.5],
    ["0", "pt-BR", 0], [" 5,25 ", "pt-BR", 5.25], [".5", "en-US", .5],
    [",5", "pt-BR", .5], ["1,", "pt-BR", 1], ["1.", "en-US", 1],
    ["1.234", "pt-BR", 1234], ["1.234", "en-US", 1.234],
  ]) assert.equal(parseAmount(text, locale), expected);
  for (const value of ["", " ", "-1", "NaN", "Infinity", "1e5", "1,2,3", "1.23.456", "9007199254740992", "12 USD", "1 000"]) {
    assert.equal(parseAmount(value, "pt-BR"), null);
    assert.equal(parseAmount(value, "en-US"), null);
  }
  assert.equal(parseAmount("1.23", "pt-BR"), null);
  assert.equal(parseAmount("1,23", "en-US"), null);
});

test("invalid inputs and overflow never become a displayed result", () => {
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(calculate(value, "annual", 12, 12, 5), null);
  for (const rate of [null, undefined, NaN, Infinity, 0, -1]) assert.equal(calculate(120000, "annual", 12, 12, rate), null);
  assert.equal(calculate(Number.MAX_SAFE_INTEGER, "annual", 12, 12, 2), null);
  assert.equal(calculate(10, "weekly", 12, 12, 1), null);
});

test("currency display respects ISO minor units and search ignores accents", () => {
  assert.equal(amount(1234.5678, "JPY", "en-US"), "1,235");
  assert.equal(amount(1234.5678, "KWD", "en-US"), "1,234.568");
  assert.equal(amount(1234.5678, "BRL", "pt-BR"), "1.234,57");
  assert.match(money(10, "USD", "en-US"), /USD\s+10\.00/);
  assert.equal(searchKey("Dólar Canadense"), "dolar canadense");
});

test("the complete HTML/CSS/JS payload stays below 40 KiB gzipped", () => {
  const root = new URL("../static/", import.meta.url);
  const bytes = readdirSync(root).filter(name => /\.(html|css|mjs)$/.test(name))
    .reduce((sum, name) => sum + gzipSync(readFileSync(new URL(name, root))).length, 0);
  assert.ok(bytes <= 40 * 1024, `Frontend: ${bytes} bytes gzipped`);
});
