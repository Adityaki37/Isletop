// Compare the current production policy with a frozen Git policy (v47 by default).
// The frozen policy is rebuilt from Git; neither seat sees opponents' private cards.
import { build } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.findIndex((arg) => arg.startsWith(`--${name}=`));
  return index < 0 ? null : args.splice(index, 1)[0].slice(name.length + 3);
};
const selected = option("baseline"),
  baselineVersion = option("baseline-label") ?? (selected ? "custom" : "v47");
const baseline = execFileSync(
  "git",
  [
    "rev-parse",
    `${selected ?? "18c54d3deb32a95bde4fbac1d025eda16beaf745"}^{commit}`,
  ],
  { encoding: "utf8" },
).trim();
const key = baseline.slice(0, 12);
const dir = `.sites-runtime/bot-baseline-${key}`;
mkdirSync(dir, { recursive: true });
const names = [
  "disconnect-bots",
  "bot-strategy-base",
  "bot-strategy-cities",
  "bot-strategy-rush",
];
for (const optional of ["bot-strategy-planned", "bot-economy"]) {
  try {
    execFileSync("git", ["cat-file", "-e", `${baseline}:lib/${optional}.ts`], {
      stdio: "ignore",
    });
    names.push(optional);
  } catch {
    // Older policies predate these modules.
  }
}
for (const name of names) {
  let body = execFileSync("git", ["show", `${baseline}:lib/${name}.ts`], {
    encoding: "utf8",
  });
  body = body.replace(
    /from "\.\/(.*?)"/g,
    (_, m) => `from "${names.includes(m) ? "./" : "../../lib/"}${m}"`,
  );
  writeFileSync(`${dir}/${name}.ts`, body);
}
await build({
  entryPoints: [`${dir}/disconnect-bots.ts`],
  outfile: `.sites-runtime/bot-baseline-${key}.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
});
const outfile = `.sites-runtime/bot-benchmark-${key}.cjs`;
await build({
  entryPoints: ["tests/bot-benchmark.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  banner: {
    js: `globalThis.baselineBotMove=require("./bot-baseline-${key}.cjs").botMove;globalThis.baselineProvenance=${JSON.stringify({ version: baselineVersion, commit: baseline })};`,
  },
});
const r = spawnSync(process.execPath, [outfile, ...args], {
  stdio: "inherit",
});
process.exitCode = r.status ?? 1;
