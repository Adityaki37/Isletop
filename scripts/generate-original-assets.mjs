// Original vector art and synthesized audio. No reference artwork is read.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
const root = process.cwd(),
  out = path.join(root, "public/art");
mkdirSync(path.join(out, "sounds"), { recursive: true });
const palette = {
  red: "#ef665f",
  blue: "#49a7dd",
  orange: "#f6a448",
  white: "#f3ead7",
  purple: "#ad82df",
  green: "#54ae78",
  pink: "#e98db1",
  black: "#465667",
  cyan: "#45c9cb", brown: "#ae714b", navy: "#6171ce", lime: "#bcd653",
};
const ink = "#193c47",
  cream = "#fff2d3";
const colors = {
  lumber: "#4c956c",
  wood: "#4c956c",
  brick: "#d47b55",
  wool: "#92b76e",
  sheep: "#92b76e",
  grain: "#e4ba55",
  wheat: "#e4ba55",
  ore: "#91a7ad",
  desert: "#dfbb84",
  gold: "#f5c956",
  sea: "#9bc4b5",
  fog: "#879da7",
  cloth: "#d281bf",
  paper: "#c0d490",
  coin: "#dfa854",
};
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const svg = (body, w = 100, h = 100) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>Original Island Table artwork</title><g stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
const text = (s, x = 50, y = 88, size = 12, fill = ink) =>
  `<text x="${x}" y="${y}" fill="${fill}" stroke="none" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" font-weight="700">${esc(s)}</text>`;
function symbol(kind, color = "#e7ba59") {
  if (kind === "icon_bot" || kind === "icon_bot_black")
    return `<g transform="translate(0 7)"><path d="M50 24V13"/><circle cx="50" cy="11" r="5" fill="${color}"/><rect x="21" y="25" width="58" height="54" rx="11" fill="${cream}"/><path d="M12 44v18m76-18v18"${kind === "icon_bot_black" ? ' stroke="#fff"' : ""} stroke-width="7"/><rect x="33" y="38" width="7" height="15" rx="3.5" fill="${ink}" stroke="none"/><rect x="60" y="38" width="7" height="15" rx="3.5" fill="${ink}" stroke="none"/><path d="M36 65h28" stroke-width="5"/></g>`;
  if (/lumber|wood|forest/.test(kind))
    return `<path d="M49 15 27 43h13L20 66h23v18h14V66h24L60 43h13Z" fill="#32765b"/><path d="M51 36v38" stroke="#b5d7a4"/>`;
  if (/sheep|wool/.test(kind))
    return `<path d="M28 64v15m33-15v15" stroke-width="7"/><path d="M24 41q-10 10 2 24h40q15-8 7-22-4-12-15-11-10-12-21-2-11-3-13 11Z" fill="${cream}"/><path d="M63 37q15-8 19 5v18q-8 8-16 0Z" fill="#46515b"/><circle cx="76" cy="43" r="2" fill="white" stroke="none"/>`;
  if (/(^|_)(ore|stone|mining)(_|$)/.test(kind))
    return `<path d="m18 69 10-28 21-8 10 28-17 17Z" fill="#77929b"/><path d="m46 74 12-31 21 1 7 28-18 9Z" fill="#adc1c5"/><path d="m29 41 13 37m17-17-30-4m29-14 10 38" fill="none"/>`;
  if (/brick/.test(kind))
    return `<path d="m20 40 24-13 32 14-24 14Z" fill="#e7a171"/><path d="M20 40v18l32 16V55m0 19 24-15V41" fill="#bd6149"/><path d="m35 34 31 15M36 49v17m26-17v18" fill="none"/>`;
  if (/grain|wheat|irrigation/.test(kind))
    return `<path d="M50 82V25m0 36L33 49m17 1 17-13m-17 3L37 29" fill="none" stroke="#8f6b33" stroke-width="4"/><g fill="#e7b440"><ellipse cx="32" cy="44" rx="7" ry="13" transform="rotate(-40 32 44)"/><ellipse cx="66" cy="32" rx="7" ry="13" transform="rotate(40 66 32)"/><ellipse cx="38" cy="25" rx="6" ry="11" transform="rotate(-25 38 25)"/><ellipse cx="50" cy="17" rx="6" ry="12"/></g>`;
  if (/paper|printer|constitution/.test(kind))
    return `<path d="M28 20h35l12 12v46H28Z" fill="${cream}"/><path d="M63 20v15h12M37 46h28M37 57h23M37 67h28" fill="none"/>`;
  if (/cloth/.test(kind))
    return `<path d="m29 23 45 12-16 46-41-12Z" fill="#c889b8"/><path d="m24 39 44 13m-47 2 42 13m-21-40-14 45m28-41-15 45" fill="none" stroke="#f4d9ec"/>`;
  if (/coin|monopoly|merchant|trade|harbor/.test(kind))
    return `<ellipse cx="44" cy="68" rx="26" ry="9" fill="#cd9638"/><path d="M18 55v13m52-13v13"/><ellipse cx="44" cy="55" rx="26" ry="9" fill="#f6d376"/><circle cx="63" cy="32" r="19" fill="#f6d376"/>${text("$", 63, 39, 23)}`;
  if (/knight|army|warlord|bishop|deserter|saboteur/.test(kind))
    return `<path d="M30 23 50 15l20 8v30Q64 72 50 82 34 71 30 53Z" fill="${color}"/><path d="M50 26v39m-10-24h20" stroke="${cream}" stroke-width="5"/>`;
  if (/crown|vp|victory|metropolis|trophy|leader/.test(kind))
    return `<path d="m20 34 16 12 14-23 14 23 17-12-9 37H28Z" fill="#f4c85f"/><path d="M28 62h44M27 77h47"/>`;
  if (/road|route|diplomat/.test(kind))
    return `<path d="M20 77 34 59 31 38 63 20 81 32" fill="none" stroke="${color}" stroke-width="15"/><path d="M20 77 34 59 31 38 63 20 81 32" fill="none" stroke="${cream}" stroke-width="3" stroke-dasharray="6 7"/>`;
  if (/ship|pirate|fleet|seafar/.test(kind))
    return `<path d="M50 14v51M26 66h54L68 80H33Z" fill="${color}"/><path d="M48 19 21 58h27m7-35 23 35H55" fill="${cream}"/><path d="M16 85q13-9 25 0t25 0 21 0" fill="none" stroke="#5d947f"/>`;
  if (/settlement/.test(kind))
    return `<path d="M15 43 50 12 85 43v43H15Z" fill="${color}" stroke-width="4"/><path d="M10 46 50 10 90 46" fill="none" stroke-width="5"/><path d="M41 86V60h18v26" fill="${ink}" stroke="none"/><rect x="23" y="55" width="11" height="12" rx="1" fill="${cream}" stroke="none"/><path d="M18 81h20m24 0h20" stroke="${cream}" opacity=".35"/>`;
  if (/city|building|engineer|crane/.test(kind))
    return `<path d="M8 88V54l22-20 22 20v34h-44M49 88V28l20-18 23 18v60Z" fill="${color}" stroke-width="4"/><path d="M5 56 30 32 54 56M46 30 69 8 95 30" fill="none" stroke-width="5"/><path d="M22 88V66h16v22M61 88V63h18v25" fill="${ink}" stroke="none"/><path d="M60 37h9v13h-9m15-13h9v13h-9" fill="${cream}" stroke="none"/><path d="M53 83h6m23 0h6" stroke="${cream}" opacity=".35"/>`;
  if (/player_loggedin/.test(kind))
    return `<circle cx="50" cy="38" r="16" fill="${cream}"/><path d="M27 31 33 13h34l6 18Z" fill="${color}"/><path d="M21 31h58M19 84V72q3-20 31-20t31 20v12Z" fill="${color}"/><path d="m36 53 14 23 14-23" fill="${cream}"/>`;
  if (/robber|robbing|intrigue/.test(kind))
    return `<path d="M24 80V49Q24 14 50 14t26 35v31Z" fill="#455862"/><path d="M34 39h32v20q-16 20-32 0Z" fill="${cream}"/><path d="M32 40h36v12H32Z" fill="#193c47"/><circle cx="41" cy="46" r="2" fill="white"/><circle cx="59" cy="46" r="2" fill="white"/>`;
  if (/yearofplenty/.test(kind))
    return `<path d="M23 50h54l-8 30H31Z" fill="#c39253"/><path d="M30 51q0-43 40 0M22 63h56M38 51v28m24-28v28" fill="none"/><circle cx="36" cy="42" r="10" fill="#e7b440"/><circle cx="58" cy="40" r="12" fill="#a0c47f"/>`;
  if (/player|user|friend|avatar|wedding/.test(kind))
    return `<circle cx="50" cy="31" r="16" fill="${cream}"/><path d="M19 84V70q4-21 31-21t31 21v14Z" fill="${color}"/><path d="m39 51 11 17 11-17" fill="${cream}"/>`;
  if (/sound|volume/.test(kind))
    return `<path d="M17 41h15l21-18v55L32 60H17Z" fill="${cream}"/>${/off/.test(kind) ? '<path d="m65 38 20 24m0-24L65 62" stroke="#ee7965" stroke-width="5"/>' : '<path d="M65 35q21 15 0 30m12-42q30 27 0 54" fill="none" stroke="#a9dfca" stroke-width="4"/>'}`;
  if (/eye|spectat|spy/.test(kind))
    return `<path d="M10 50q40-48 80 0-40 48-80 0Z" fill="${cream}"/><circle cx="50" cy="50" r="17" fill="#489aab"/><circle cx="50" cy="50" r="7" fill="${ink}"/>`;
  if (/clock|time|remind/.test(kind))
    return `<circle cx="50" cy="50" r="33" fill="${cream}"/><path d="M50 27v25l17 12" fill="none" stroke-width="5"/>`;
  if (/play$|forward/.test(kind))
    return `<path d="m30 20 49 30-49 30Z" fill="${cream}"/>${/end/.test(kind) ? '<path d="M84 20v60" stroke-width="7"/>' : ""}`;
  if (/pause/.test(kind))
    return '<path d="M30 24v52m35-52v52" stroke="#fff2d3" stroke-width="15"/>';
  if (/arrow|rewind/.test(kind))
    return '<path d="m67 22-40 28 40 28Z" fill="#fff2d3"/>';
  if (/share/.test(kind))
    return '<path d="M26 64V46h18V23m-13 12 13-13 13 13m-7 24h24v22H26V64" fill="none" stroke="#fff2d3" stroke-width="5"/>';
  if (/full.*expand|fullscreen_expand/.test(kind))
    return '<path d="M15 38V15h23m24 0h23v23M15 62v23h23m24 0h23V62" fill="none" stroke="#fff2d3" stroke-width="6"/>';
  if (/contract/.test(kind))
    return '<path d="M15 38h23V15m24 0v23h23M15 62h23v23m24 0V62h23" fill="none" stroke="#fff2d3" stroke-width="6"/>';
  if (/question/.test(kind)) return text("?", 50, 76, 70, cream);
  if (/more/.test(kind))
    return [25, 50, 75]
      .map((x) => `<circle cx="${x}" cy="50" r="6" fill="${cream}"/>`)
      .join("");
  if (/flag/.test(kind))
    return '<path d="M25 84V16l48 9-14 20 14 20-48-8" fill="#f4c85f"/>';
  if (/alchemist|medicine/.test(kind))
    return '<path d="M39 17h22m-16 0v27L25 74q-3 12 12 12h29q13 0 10-12L57 44V17" fill="#9bd5d2"/><path d="M34 65h32" stroke="#f7f1c9" stroke-width="6"/>';
  const label = kind
    .replace(/^(icon|stat|card|gamemode|rank)_/, "")
    .split("_")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `<path d="m50 12 31 18v39L50 88 19 69V30Z" fill="${color}"/>${text(label || "IT", 50, 60, 25, cream)}`;
}
function make(name) {
  const color =
    palette[Object.keys(palette).find((c) => name.includes("_" + c))] ??
    "#e9b958";
  if (name.startsWith("player_bg_"))
    return svg(
      `<rect x="2" y="2" width="96" height="96" rx="22" fill="${color}"/><path d="M8 72 28 38l20 16 27-32 17 50" fill="none" stroke="${cream}" opacity=".35"/>`,
    );
  if (name === "ribbon_short")
    return svg(
      `<path d="M2 8h96L86 25l12 17H2l12-17Z" fill="#193c47"/><path d="M15 13h70m-70 23h70" stroke="${cream}" opacity=".4"/>`,
      100,
      50,
    );
  if (name.startsWith("icon_merchant_"))
    return svg(
      `<circle cx="44" cy="26" r="13" fill="${cream}"/><path d="M21 82V58q1-19 23-19t23 19v24Z" fill="${color}"/><circle cx="69" cy="60" r="16" fill="#f4c85f"/>${text("$", 69, 67, 22)}`,
    );
  if (name.startsWith("metropolis_")) {
    const fill = /politics/.test(name)
      ? "#7c9fce"
      : /science/.test(name)
        ? "#88bd88"
        : "#e1bd63";
    return svg(
      `<circle cx="50" cy="50" r="44" fill="${fill}"/>${symbol("crown")}`,
    );
  }
  if (/^dice_event_/.test(name)) {
    const event = name.replace("dice_event_", ""),
      fill = {
        politics: "#7c9fce",
        science: "#88bd88",
        trade: "#e1bd63",
        barbarian: "#6a8591",
      }[event];
    return svg(
      `<rect x="5" y="5" width="90" height="90" rx="17" fill="${fill}"/><g transform="translate(8 8) scale(.84)">${symbol(event === "barbarian" ? "ship" : event === "politics" ? "knight" : event === "science" ? "paper" : "coin")}</g>`,
    );
  }
  if (/wall/.test(name))
    return svg(
      `<path d="M5 18v-9h12v9h13V9h13v9h14V9h13v9h13V9h12v37H5Z" fill="${color}"/><path d="M5 31h90M24 18v13m27-13v13m26-13v13M38 31v15m28-15v15" fill="none"/>`,
      100,
      50,
    );
  if (name === "logo" || name === "logo_mobile")
    return svg(
      `<path d="m50 8 38 22v43L50 95 12 73V30Z" fill="#70bda7"/><path d="m27 64 11-29 12 11 14-21 14 39Z" fill="${cream}"/>${text("ISLETOP", 50, 79, 11)}`,
      100,
      100,
    );
  if (name.startsWith("generated_tile_") || name === "tile_fog") {
    const kind = name.replace("generated_tile_", "").replace("tile_", ""),
      bg = colors[kind] ?? colors.fog;
    return svg(
      `<path d="M50 2 92 26v48L50 98 8 74V26Z" fill="${bg}" stroke="#f7dfaa" stroke-width="3"/><path d="M14 30 50 9 86 30M14 71 50 91 86 71" fill="none" stroke="#fff2d3" opacity=".24"/>${kind === "desert" ? '<path d="M16 68q17-26 34-8t34-5M22 78q32-20 54 0" fill="none" stroke="#b68d59"/><circle cx="65" cy="28" r="9" fill="#f9dda6" stroke="none"/>' : kind === "fog" ? '<path d="M18 42q20-18 33 0t32 0M16 59q22-18 36 0t30 0" fill="none" stroke="#d8e6e4" stroke-width="8"/>' : `<g transform="translate(28 3) scale(.44)">${symbol(kind)}</g>`}`,
    );
  }
  if (name.startsWith("card_")) {
    const kind = name.replace("card_", ""),
      bg =
        ["devcardback", "knight", "monopoly", "roadbuilding", "yearofplenty", "vp"].includes(kind) ? "#8754b6" : colors[kind] ??
        (/politics/.test(kind)
          ? "#728bbd"
          : /science/.test(kind)
            ? "#83b98e"
            : /trade/.test(kind)
              ? "#e0b464"
              : "#77a9a3");
    const back = /back/.test(kind);
    return svg(
      `<rect x="3" y="3" width="94" height="134" rx="9" fill="${cream}"/><rect x="8" y="8" width="84" height="124" rx="6" fill="${bg}" stroke="none"/><path d="M14 22h72M14 118h72" stroke="${cream}" opacity=".65"/><g transform="translate(5 24) scale(.9)">${back ? '<path d="m50 8 32 19v45L50 90 18 72V27Z" fill="#dce9d2"/><path d="m30 62 12-30 12 16 16-23v37Z" fill="#2d7f78"/>' : symbol(kind)}</g>`,
      100,
      140,
    );
  }
  if (name.startsWith("dice_")) {
    const n = Number(name.slice(-1));
    const pts =
      n === 1
        ? [[50, 50]]
        : n === 2
          ? [
              [28, 28],
              [72, 72],
            ]
          : n === 3
            ? [
                [28, 28],
                [50, 50],
                [72, 72],
              ]
            : n === 4
              ? [
                  [28, 28],
                  [72, 28],
                  [28, 72],
                  [72, 72],
                ]
              : n === 5
                ? [
                    [28, 28],
                    [72, 28],
                    [50, 50],
                    [28, 72],
                    [72, 72],
                  ]
                : [
                    [28, 25],
                    [72, 25],
                    [28, 50],
                    [72, 50],
                    [28, 75],
                    [72, 75],
                  ];
    return svg(
      `<rect x="6" y="6" width="88" height="88" rx="17" fill="${name.startsWith("dice_red_") ? "#cf514e" : cream}"/>${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${name.startsWith("dice_red_") ? cream : ink}"/>`).join("")}`,
    );
  }
  if (name.startsWith("road_"))
    return `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="30" viewBox="0 0 58 30"><title>Road</title><line x1="7" y1="15" x2="51" y2="15" stroke="#193c47" stroke-width="11" stroke-linecap="round"/><line x1="7" y1="15" x2="51" y2="15" stroke="${color}" stroke-width="7.5" stroke-linecap="round"/></svg>`;
  if (name.startsWith("settlement_") || name.startsWith("city_"))
    return svg(symbol(name, color));
  if (name.startsWith("knight_")) {
    const level = Number(name.match(/level(\d)/)?.[1] ?? 1);
    return svg(
      `${symbol("knight", color)}${Array.from({ length: level }, (_, i) => `<circle cx="${50 + (i - (level - 1) / 2) * 11}" cy="91" r="4" fill="${/inactive/.test(name) ? "#91a0a5" : "#f4cd66"}"/>`).join("")}${/inactive/.test(name) ? '<path d="M25 20 75 78" stroke="#b9c5c8" opacity=".5" stroke-width="5"/>' : ""}`,
    );
  }
  if (
    name.startsWith("map_") ||
    /^(base|seafarers|cities_and_knights)/.test(name)
  ) {
    const tiles = [];
    for (let q = -2; q <= 2; q++)
      for (let r = -2; r <= 2; r++)
        if (Math.abs(q + r) <= 2) {
          const x = 160 + q * 38 + r * 19,
            y = 110 + r * 33;
          tiles.push(
            `<path d="m${x} ${y - 22} 19 11v22l-19 11-19-11v-22Z" fill="${Object.values(colors)[(q * q + r * r + q + r + 20) % 10]}" stroke="${cream}" stroke-width="2"/>`,
          );
        }
    return svg(
      `<rect width="320" height="220" rx="12" fill="#b8d5c8" stroke="none"/>${tiles.join("")}${/ss|seafar/.test(name) ? '<g transform="translate(220 120) scale(.65)">' + symbol("ship") + "</g>" : ""}${/knights/.test(name) ? '<g transform="translate(20 120) scale(.65)">' + symbol("knight") + "</g>" : ""}`,
      320,
      220,
    );
  }
  if (/metropolis/.test(name)) return svg(symbol("metropolis", color));
  return svg(symbol(name, color));
}
const manifest = path.join(root, "scripts/original-assets.json");
const mapping = new Map(
  existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8")).map((a) => [a.url, a])
    : [],
);
let images = 0,
  sounds = 0;
writeFileSync(manifest, JSON.stringify([...mapping.values()], null, 2) + "\n");
for (const { url, name, audio } of mapping.values()) {
  const dest = path.join(root, "public", url);
  if (audio) {
    const rate = 22050,
      duration = /victory|achievement|game_started/.test(name)
        ? 0.9
        : /dice/.test(name)
          ? 0.42
          : 0.18,
      count = Math.floor(rate * duration),
      b = Buffer.alloc(44 + count * 2);
    b.write("RIFF");
    b.writeUInt32LE(b.length - 8, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * 2, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write("data", 36);
    b.writeUInt32LE(count * 2, 40);
    const hash = [...name].reduce((s, c) => s + c.charCodeAt(0), 0),
      base = [261.63, 293.66, 329.63, 392, 440, 523.25][hash % 6];
    for (let i = 0; i < count; i++) {
      const t = i / rate,
        step = Math.floor(t / 0.13),
        frequency = base * Math.pow(2, [0, 4, 7, 12][step % 4] / 12),
        envelope = Math.min(1, t / 0.01) * Math.pow(1 - t / duration, 2),
        wave =
          Math.sin(2 * Math.PI * frequency * t) +
          0.2 * Math.sin(2 * Math.PI * frequency * 2 * t);
      b.writeInt16LE(Math.round(wave * envelope * 7000), 44 + i * 2);
    }
    writeFileSync(dest, b);
    sounds++;
  } else {
    writeFileSync(dest, make(name));
    images++;
  }
}
writeFileSync(path.join(out, "icon_bot_black.svg"), svg(symbol("icon_bot_black")));
images++;
for (const color of ["cyan", "brown", "navy", "lime"])
  for (const filename of readdirSync(out).filter(name => /_black(?:_north_west)?\.svg$/.test(name) && name !== "icon_bot_black.svg")) {
    const name = filename.replace("_black", `_${color}`).replace(/\.svg$/, "");
    writeFileSync(path.join(out, `${name}.svg`), make(name));
    images++;
  }
mkdirSync(path.join(out, "regions"), { recursive: true });
const previewModule = path.join(
  root,
  ".sites-runtime/generate-map-previews.mjs",
);
await build({
  entryPoints: ["scripts/generate-map-previews.ts"],
  outfile: previewModule,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { generateMapPreviews } = await import(pathToFileURL(previewModule).href);
const previews = generateMapPreviews(root);
const countries = JSON.parse(
  readFileSync(path.join(root, "lib/regions-data.json"), "utf8"),
);
for (const code of Object.keys(countries))
  writeFileSync(
    path.join(out, "regions", `${code}.svg`),
    svg(
      `<rect x="5" y="18" width="90" height="64" rx="15" fill="#daf0e7"/>${text(code, 50, 61, 29)}`,
    ),
  );
writeFileSync(
  path.join(out, "PROVENANCE.md"),
  `# Original Island Table assets\n\nAll ${images} game SVG images and ${Object.keys(countries).length} region badges are generated from original shapes and compositions in scripts/generate-original-assets.mjs. All ${sounds} WAV effects are synthesized from original oscillators, envelopes and note sequences in the same generator. No downloaded image, font or audio file is used as an input. Artwork uses system fonts. Countries use original country-code badges instead of downloaded flag artwork.\n`,
);
writeFileSync(
  path.join(root, ".sites-runtime/original-asset-map.json"),
  JSON.stringify([...mapping.entries()], null, 2),
);
console.log(JSON.stringify({ images, sounds, previews }));
