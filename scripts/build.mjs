import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";

mkdirSync("static/chunks", { recursive: true });
for (const name of readdirSync("static/chunks")) {
  if (/^(brazil|chunk)-[A-Z0-9]+\.mjs$/.test(name)) unlinkSync(`static/chunks/${name}`);
}

await build({
  entryPoints: ["frontend/app.ts"], bundle: true, splitting: true,
  format: "esm", platform: "browser", target: "es2022", minify: true,
  outdir: "static", entryNames: "app", chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
});
mkdirSync("static/icons", { recursive: true });
for (const name of ["style.css", "Phosphor.woff2"])
  copyFileSync(`node_modules/@phosphor-icons/web/src/regular/${name}`, `static/icons/${name}`);
copyFileSync("node_modules/@phosphor-icons/web/LICENSE", "static/icons/LICENSE");
