import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const manifest = JSON.parse(
  readFileSync("scripts/original-assets.json", "utf8"),
);
assert.equal(new Set(manifest.map((a) => a.url)).size, manifest.length);
assert(readdirSync("public").every(name => name === "art" || name === "favicon.svg" || name === "third-party-notices.txt"),
  "Public assets must use the project's documented asset directories.");
assert(!existsSync("public/flags"));
for (const a of manifest) {
  const file = path.join(root, "public", a.url),
    b = readFileSync(file);
  if (a.audio) {
    assert.equal(b.toString("ascii", 0, 4), "RIFF", a.url);
    assert.equal(b.toString("ascii", 8, 12), "WAVE", a.url);
    assert.equal(b.readUInt32LE(4) + 8, b.length, a.url);
    assert.equal(b.readUInt32LE(40) + 44, b.length, a.url);
    assert.equal(b.readUInt16LE(34), 16, a.url);
    assert(
      b.subarray(44).some((v) => v !== 0),
      a.url,
    );
  } else {
    const s = b.toString("utf8").trim();
    assert(s.startsWith("<svg ") && s.endsWith("</svg>"), a.url);
    assert(
      !/<image|<script|<foreignObject|href=|data:/.test(s),
      a.url,
    );
    assert(!/NaN|undefined/.test(s), a.url);
  }
}
for (const dir of ["app", "components", "lib"])
  for (const file of walk(dir).filter((f) => /\.(css|tsx?)$/.test(f))) {
    const s = readFileSync(file, "utf8");
    assert(!/\/flags\/|\.woff/.test(s), file);
    for (const url of s.match(/\/art\/[a-zA-Z0-9_\/-]+\.(svg|wav)/g) ?? [])
      assert(existsSync(path.join(root, "public", url)), `${file}: ${url}`);
  }
const art = (name) => readFileSync(`public/art/${name}.svg`, "utf8");
assert.notEqual(art("city_red"), art("settlement_red"));
assert.notEqual(art("icon_more"), art("card_ore"));
assert.equal(
  new Set(
    ["barbarian", "politics", "science", "trade"].map((n) =>
      art(`dice_event_${n}`),
    ),
  ).size,
  4,
);
assert.equal(
  new Set([1, 2, 3, 4].map((n) => art(`map_ss${n}_4p_preview`))).size,
  4,
);
for (const code of Object.keys(
  JSON.parse(readFileSync("lib/regions-data.json", "utf8")),
))
  assert(existsSync(`public/art/regions/${code}.svg`), code);
console.log(
  `Original asset checks passed: ${manifest.filter((a) => !a.audio).length} game images, ${manifest.filter((a) => a.audio).length} sounds, ${readdirSync("public/art/regions").length} country badges.`,
);
