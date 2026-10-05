import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { amount, calculate, changePeriod, compareSalaries, formatSalaryText, money, parseAmount, searchKey } from "../frontend/core.ts";
import { flagFor } from "../frontend/flags.ts";

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

test("editing either side recovers the original amount for independent periods", () => {
  for (const sourcePeriod of ["hourly", "monthly", "annual"]) {
    for (const targetPeriod of ["monthly", "annual"]) {
      for (const sourcePayments of [12, 13]) {
        for (const targetPayments of [12, 13]) {
          for (const rate of [1, 2.5]) {
            const forward = calculate(1234.56, sourcePeriod, sourcePayments, targetPayments, rate, 37.5);
            const reverse = calculate(forward[targetPeriod], targetPeriod, targetPayments, sourcePayments, 1 / rate, 37.5);
            assert.ok(Math.abs(reverse[sourcePeriod] - 1234.56) < 1e-8);
          }
        }
      }
    }
  }
});

test("hourly pay uses weekly hours and ignores source 13th payment", () => {
  for (const sourcePayments of [12, 13]) {
    for (const targetPayments of [12, 13]) {
      const result = calculate(25, "hourly", sourcePayments, targetPayments, 2, 37.5);
      assert.equal(result.sourceAnnual, 48750);
      assert.equal(result.annual, 97500);
      assert.equal(result.monthly, 97500 / targetPayments);
      assert.equal(result.hourly, 50);
    }
  }
  assert.equal(calculate(120000, "annual", 12, 12, 1, 40).hourly, 120000 / 2080);
  assert.equal(calculate(120000, "annual", 12, 12, 1, 30).annual, 120000);
  assert.equal(calculate(120000, "annual", 12, 12, 1, 30).hourly, 120000 / 1560);
});

test("switching periods keeps full precision instead of reusing formatted values", () => {
  let value = 120000;
  for (let i = 0; i < 100; i++) {
    value = changePeriod(value, "annual", "monthly", 13);
    value = changePeriod(value, "monthly", "annual", 13);
  }
  assert.ok(Math.abs(value - 120000) < 1e-8);
  assert.equal(changePeriod(null, "annual", "monthly", 12), null);
  value = 120000;
  for (let i = 0; i < 100; i++) {
    value = changePeriod(value, "annual", "hourly", 13, 37.5);
    value = changePeriod(value, "hourly", "monthly", 13, 37.5);
    value = changePeriod(value, "monthly", "annual", 13, 37.5);
  }
  assert.ok(Math.abs(value - 120000) < 1e-8);
  assert.equal(changePeriod(Number.MAX_SAFE_INTEGER, "hourly", "annual", 12, 40), null);
  assert.equal(changePeriod(120000, "annual", "hourly", 12, 1e-13), null);
});

test("manual rates, identity rates and zero salary", () => {
  assert.deepEqual(calculate(1000, "monthly", 13, 12, 2.5), { sourceAnnual: 13000, annual: 32500, monthly: 32500 / 12, hourly: 32500 / 2080 });
  assert.equal(calculate(1000, "monthly", 12, 12, 1).monthly, 1000);
  assert.deepEqual(calculate(0, "annual", 12, 13, 5), { sourceAnnual: 0, annual: 0, monthly: 0, hourly: 0 });
});

test("salary comparison uses annual, payment, and each job's hourly basis", () => {
  const a = calculate(120000, "annual", 12, 12, 1, 40);
  const b = calculate(750000, "annual", 13, 13, 1, 20);
  const result = compareSalaries(a, b, 5);
  assert.equal(result.percent, 25);
  assert.equal(result.annual.inA, 30000);
  assert.equal(result.annual.inB, 150000);
  assert.ok(Math.abs(result.monthly.inA - (750000 / 13 / 5 - 10000)) < 1e-8);
  assert.ok(Math.abs(result.hourly.inA - (750000 / 1040 / 5 - 120000 / 2080)) < 1e-8);
  assert.equal(compareSalaries(calculate(0, "annual", 12, 12, 1), b, 5).percent, null);
  assert.equal(compareSalaries(a, b, 0), null);
  assert.equal(compareSalaries(a, b, 1e-300), null);
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

test("salary formatting groups while typing and keeps the cursor by the edited digit", () => {
  let text = "", cursor = 0;
  for (const digit of "235000") {
    const result = formatSalaryText(text.slice(0, cursor) + digit + text.slice(cursor), cursor + 1, "en-US");
    ({ text, cursor } = result);
  }
  assert.equal(text, "235,000");
  assert.equal(cursor, text.length);
  assert.deepEqual(formatSalaryText("12,9345", 4, "en-US"), { text: "129,345", cursor: 3, value: 129345 });
  assert.deepEqual(formatSalaryText("1234.", 5, "en-US"), { text: "1,234.", cursor: 6, value: 1234 });
  assert.deepEqual(formatSalaryText("1234,50", 7, "pt-BR"), { text: "1.234,50", cursor: 8, value: 1234.5 });
  assert.equal(formatSalaryText("bad", 3, "en-US"), null);
});

test("invalid inputs and overflow never become a displayed result", () => {
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(calculate(value, "annual", 12, 12, 5), null);
  for (const rate of [null, undefined, NaN, Infinity, 0, -1]) assert.equal(calculate(120000, "annual", 12, 12, rate), null);
  assert.equal(calculate(Number.MAX_SAFE_INTEGER, "annual", 12, 12, 2), null);
  for (const hours of [null, NaN, Infinity, 0, -1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(calculate(25, "hourly", 12, 12, 1, hours), null);
  }
  assert.equal(calculate(Number.MAX_SAFE_INTEGER, "hourly", 12, 12, 1, 40), null);
  assert.equal(calculate(10, "weekly", 12, 12, 1), null);
});

test("currency display respects ISO minor units and search ignores accents", () => {
  assert.equal(amount(1234.5678, "JPY", "en-US"), "1,235");
  assert.equal(amount(1234.5678, "KWD", "en-US"), "1,234.568");
  assert.equal(amount(1234.5678, "BRL", "pt-BR"), "1.234,57");
  assert.match(money(10, "USD", "en-US"), /USD\s+10\.00/);
  assert.equal(searchKey("Dólar Canadense"), "dolar canadense");
});

test("flag lookup handles euro, currency families and unknown issuers", () => {
  assert.equal(flagFor("EUR"), "/static/flags/eu.svg");
  assert.equal(flagFor("XAU"), "/static/flags/neutral.svg");
  assert.equal(flagFor("ZZZ"), "/static/flags/neutral.svg");
  assert.equal(flagFor("USD"), "/static/flags/us.svg");
});

test("annual hours overflow is rejected", () => {
  assert.equal(calculate(1, "hourly", 12, 12, 1, 1e308), null);
});

test("the complete HTML/CSS/JS payload stays below 40 KiB gzipped", () => {
  const root = join(process.cwd(), "static");
  const files = [...readdirSync(root).filter(name => /\.(html|css|mjs)$/.test(name)), join("icons", "style.css")];
  const bytes = files
    .reduce((sum, name) => sum + gzipSync(readFileSync(join(root, name))).length, 0);
  assert.ok(bytes <= 40 * 1024, `Frontend: ${bytes} bytes gzipped`);
});

test("all lazy chunks keep the loaded experience below 80 KiB gzipped", () => {
  const root = join(process.cwd(), "static");
  const files = [...readdirSync(root).filter(name => /\.(html|css|mjs)$/.test(name)),
    ...readdirSync(join(root, "chunks")).map(name => join("chunks", name)), join("icons", "style.css")];
  const bytes = files.reduce((sum, name) => sum + gzipSync(readFileSync(join(root, name))).length, 0);
  assert.ok(bytes <= 80 * 1024, `Loaded frontend: ${bytes} bytes gzipped`);
});
