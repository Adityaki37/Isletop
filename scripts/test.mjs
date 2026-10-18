import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir(".sites-runtime/tests", { recursive: true });
await build({
  entryPoints: ["tests/game.test.ts"],
  outfile: ".sites-runtime/tests/game.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const r = spawnSync(
  process.execPath,
  ["--test", ".sites-runtime/tests/game.cjs"],
  { stdio: "inherit" },
);
process.exitCode = r.status ?? 1;
