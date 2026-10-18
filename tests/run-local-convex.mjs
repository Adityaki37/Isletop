import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { build } from "esbuild";
import { spawn } from "node:child_process";
loadEnvFile(".env.local");
assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("local:"),
  "Refusing cloud target.",
);
const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL);
assert.equal(url.protocol, "http:");
assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
const output = ".sites-runtime/local-convex-smoke.mjs";
await build({
  entryPoints: ["tests/convex-local-smoke.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["ws"],
});
const child = spawn(process.execPath, [output], {
  stdio: "inherit",
  windowsHide: true,
});
process.exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
