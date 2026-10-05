import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { currenciesResponseSchema, errorResponseSchema, rateSchema } from "../frontend/contracts.ts";

const cases = JSON.parse(readFileSync("tests/contracts.json", "utf8"));
const schemas = { rate: rateSchema, currencies: currenciesResponseSchema, error: errorResponseSchema };

for (const [index, { kind, valid, payload }] of cases.entries()) {
  test(`shared API contract ${index}: ${kind} ${valid ? "valid" : "invalid"}`, () => {
    const result = schemas[kind].safeParse(payload);
    assert.equal(result.success, valid);
    if (result.success) assert.deepEqual(result.data, payload);
  });
}
