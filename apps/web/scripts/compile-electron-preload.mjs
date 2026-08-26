import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(appRoot, "src-election/preload/index.ts");
const outfile = resolve(appRoot, "out-election/preload/index.js");

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2020",
  external: ["electron"],
  sourcemap: false,
  minify: false,
});

console.log(`[electron] bundled sandbox preload: ${outfile}`);
