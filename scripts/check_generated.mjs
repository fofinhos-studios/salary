import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["frontend/app.ts"], bundle: true, splitting: true,
  format: "esm", platform: "browser", target: "es2022", minify: true,
  outdir: "static", entryNames: "app", chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" }, write: false,
});
const generated = result.outputFiles.map(file => file.path.replaceAll("\\", "/").split("/static/")[1]);
const committed = ["app.mjs", ...readdirSync("static/chunks").map(name => `chunks/${name}`)];
assert.deepEqual(generated.sort(), committed.sort(), "Generated files changed; run npm run build");
for (const file of result.outputFiles) {
  const path = file.path.replaceAll("\\", "/").split("/static/")[1];
  assert.deepEqual(Buffer.from(file.contents), readFileSync(`static/${path}`),
    "The committed bundle is stale; run npm run build");
}
