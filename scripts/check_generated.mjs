import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["frontend/app.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
});
assert.deepEqual(Buffer.from(result.outputFiles[0].contents), readFileSync("static/app.mjs"),
  "The committed bundle is stale; run npm run build");
