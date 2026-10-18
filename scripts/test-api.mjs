import { build } from "esbuild";
import { spawn } from "node:child_process";
import { attachTestInspector } from "./test-inspector.mjs";
const suite = process.argv[2];
const entry = [
  "convex-clock-api",
  "convex-live-load",
  "convex-storage-smoke",
].includes(suite)
  ? suite
  : suite === "room-setup"
      ? "room-setup-api"
    : suite === "map-choice"
      ? "map-choice-api"
    : suite === "bot-practice"
      ? "bot-practice-api"
      : suite === "bots"
        ? "bots-api"
        : suite === "regions"
          ? "regions-api"
          : suite === "ranked"
            ? "ranked-api"
            : suite === "matchmaking"
              ? "matchmaking-api"
              : suite === "avatars"
                ? "avatars-api"
                : suite === "pause"
                  ? "pause-api"
                  : suite === "connections"
                    ? "connections-api"
                    : suite === "special-building"
                      ? "special-building-api"
                      : suite === "base-updates"
                        ? "base-updates-api"
                        : suite === "spectators"
                          ? "spectators-api"
                          : suite === "social"
                            ? "social-api"
                            : suite === "accounts"
                              ? "accounts-api"
                              : suite === "replay"
                                ? "replay-api"
                                : suite === "players"
                                  ? "player-count-api"
                                  : suite === "cities"
                                    ? "cities-full-api"
                                    : suite === "history"
                                      ? "history-api"
                                      : suite === "rush"
                                        ? "rush-api"
                                        : suite === "trades"
                                          ? "trade-api"
                                          : "api-flow";
const output = `.sites-runtime/tests/${entry}.mjs`;
await build({
  entryPoints: [`tests/${entry}.ts`],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const inspector = await attachTestInspector(process.env.TEST_INSPECTOR_ORIGIN);
try {
  const child = spawn(process.execPath, [output, ...process.argv.slice(3)], {
    stdio: "inherit",
    env: process.env,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (inspector) console.log("Final worker heap:", await inspector.heap());
} finally {
  inspector?.close();
}
