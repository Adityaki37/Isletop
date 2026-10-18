import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Retain installed distribution notices without granting a license to game code.
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const upstream = JSON.parse(
  readFileSync("vendor/licenses/sources.json", "utf8"),
);
const inventory = [];
const notices = [];
function collect(dir, depth = 0) {
  if (depth > 5) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : collect(path, depth + 1);
    return /^(licen[sc]e|copying|notice)(\.|$|[-_])/i.test(entry.name)
      ? [path]
      : [];
  });
}
const retained = new Map();
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/") || info.dev) continue;
  const installed = existsSync(join(path, "package.json"));
  const pkg = installed
    ? JSON.parse(readFileSync(join(path, "package.json"), "utf8"))
    : {};
  const name = pkg.name ?? path.split("node_modules/").at(-1);
  const files = installed ? collect(path) : [];
  const fallback = upstream.find(
    (s) =>
      (!s.versions || s.versions.includes(info.version)) &&
      (s.name === name ||
        (s.name === "embla-carousel" && name.startsWith("embla-carousel"))),
  );
  if (installed && !files.length && fallback)
    files.push(`vendor/licenses/${fallback.file ?? fallback.name + ".txt"}`);
  const row = {
    name,
    packagePath: path,
    version: info.version,
    declaredLicense: info.license,
    installed,
    notices: files.map((f) => f.replaceAll("\\", "/")),
    upstream: fallback?.url ?? null,
    upstreamScope: fallback?.scope ?? null,
    noticeSha256: files.map((f) =>
      createHash("sha256").update(readFileSync(f)).digest("hex"),
    ),
  };
  inventory.push(row);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    const existing = retained.get(hash);
    if (existing) existing.packages.push(`${name}@${info.version} (${file})`);
    else
      retained.set(hash, {
        text,
        packages: [`${name}@${info.version} (${file})`],
      });
  }
}
for (const file of [
  "vendor/shadcn-tailwind-4.13.0.LICENSE.md",
  "vendor/sites-vite-plugin.LICENSE",
])
  notices.push(`Source: ${file}\n\n${readFileSync(file, "utf8")}`);
for (const { text, packages } of retained.values())
  notices.push(`${packages.join("\n")}\n\n${text}`);
writeFileSync(
  "public/third-party-notices.txt",
  "Third-party software notices\n\nThese licenses apply to the named dependencies, not to this game's original source or artwork. The inventory includes optional and server/build dependencies conservatively and does not assert that every package is shipped to browsers.\n\n" +
    notices.join("\n\n" + "=".repeat(72) + "\n\n") +
    "\n",
);
writeFileSync(
  "docs/THIRD-PARTY-LICENSE-INVENTORY.json",
  JSON.stringify(
    {
      packageLockSha256: createHash("sha256")
        .update(readFileSync("package-lock.json"))
        .digest("hex"),
      upstream,
      packages: inventory,
      missingDistributionNotices: inventory
        .filter((r) => r.installed && !r.notices.length)
        .map((r) => r.name),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Retained ${retained.size} distinct notices; ${inventory.filter((r) => r.installed && !r.notices.length).length} installed distributions need further notice review.`,
);
