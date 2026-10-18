import { MAX_PLAYERS } from "./player-colors";
import type { View } from "./game";
import { ASSETS } from "./assets";
import { avatarAsset, normalizeAvatar } from "./avatars";

export const RESULT_IMAGE_WIDTH = 1080;
export const RESULT_IMAGE_HEIGHT = 608;
export const RESULT_IMAGE_ASSETS = {
  crown: "/art/icon_crown.svg",
  ribbon: "/art/ribbon_short.svg",
  arrow: "/art/icon_arrow_white.svg",
  backgrounds: [
    "/art/player_bg_red.svg",
    "/art/player_bg_blue.svg",
    "/art/player_bg_orange.svg",
    "/art/player_bg_white.svg",
    "/art/player_bg_purple.svg",
    "/art/player_bg_green.svg",
    "/art/player_bg_pink.svg",
    "/art/player_bg_black.svg",
    "/art/player_bg_cyan.svg",
    "/art/player_bg_brown.svg",
    "/art/player_bg_navy.svg",
    "/art/player_bg_lime.svg",
  ],
} as const;

// The exporter receives only public final scores, names and colors. Hands,
// identities, chat, private statistics and replay tokens are not copied.
export function resultImageModel(
  g: Pick<View, "phase" | "winner" | "players">,
) {
  if (g.phase !== "finished" || g.winner === null || !g.players[g.winner])
    throw new Error("Result images are available after the game finishes.");
  if (!g.players.length || g.players.length > MAX_PLAYERS)
    throw new Error("Choose a completed game with one to twelve players.");
  const players = g.players.map(({ name, color, score, avatar }, seat) => ({
    name,
    color,
    score,
    avatar: normalizeAvatar(avatar),
    seat,
    winner: seat === g.winner && g.players.length > 1,
  }));
  // The reference swaps the winning seat to the final position, then reverses
  // each of its two displayed rows. Keep scores tied to seat, never sort alone.
  [players[g.winner], players[players.length - 1]] = [
    players[players.length - 1],
    players[g.winner],
  ];
  const top = players
    .filter(
      (_, index) => players.length < 3 || index > (players.length - 1) / 2,
    )
    .reverse();
  const bottom = players.filter((p) => !top.includes(p)).reverse();
  return {
    rows: [top, bottom].filter((row) => row.length),
    count: players.length,
  };
}
export type ResultImageModel = ReturnType<typeof resultImageModel>;

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException("Image generation cancelled.", "AbortError");
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read image artwork."));
    reader.readAsDataURL(blob);
  });
}
function imageFromUrl(
  url: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const image = new Image();
    const abort = () => {
      image.src = "";
      finish(new DOMException("Image generation cancelled.", "AbortError"));
    };
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => finish();
    image.onerror = () =>
      finish(new Error("Unable to render result artwork. Please retry."));
    image.src = url;
  });
}
export async function renderResultImage(
  model: ResultImageModel,
  board: SVGSVGElement,
  signal: AbortSignal,
): Promise<Blob> {
  const cache = new Map<string, Promise<string>>();
  const asset = (path: string) => {
    if (!/^\/art\/[\w.-]+\.(svg|png)$/.test(path))
      throw new Error("Unsupported result artwork.");
    if (!cache.has(path))
      cache.set(
        path,
        (async () => {
          const response = await fetch(path, { signal });
          if (!response.ok)
            throw new Error("Unable to load result artwork. Please retry.");
          return dataUrl(await response.blob());
        })(),
      );
    return cache.get(path)!;
  };
  const artwork = (path: string) =>
    asset(path).then((url) => imageFromUrl(url, signal));
  const clone = board.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(board.viewBox.baseVal.width));
  clone.setAttribute("height", String(board.viewBox.baseVal.height));
  clone.setAttribute("font-family", "Arial, sans-serif");
  await Promise.all(
    [...clone.querySelectorAll("image")].map(async (element) => {
      const href = element.getAttribute("href");
      if (!href) throw new Error("Result artwork has no source.");
      element.setAttribute("href", await asset(href));
      element.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    }),
  );
  const boardUrl = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const [map, logo, avatars, crown, ribbon, arrow, backgrounds] =
      await Promise.all([
        imageFromUrl(boardUrl, signal),
        artwork(ASSETS.logo),
        Promise.all(
          model.rows.flat().map((p) => artwork(avatarAsset(p.avatar))),
        ),
        artwork(RESULT_IMAGE_ASSETS.crown),
        artwork(RESULT_IMAGE_ASSETS.ribbon),
        artwork(RESULT_IMAGE_ASSETS.arrow),
        Promise.all(
          model.rows
            .flat()
            .map((p) => artwork(RESULT_IMAGE_ASSETS.backgrounds[p.color])),
        ),
        document.fonts.load('700 20px "Arial"'),
      ]);
    throwIfAborted(signal);
    const canvas = document.createElement("canvas");
    canvas.width = RESULT_IMAGE_WIDTH;
    canvas.height = RESULT_IMAGE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot generate result images.");
    ctx.fillStyle = "#24574d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(576 / map.width, 576 / map.height),
      mw = map.width * scale,
      mh = map.height * scale;
    ctx.drawImage(map, 8 + (576 - mw) / 2, (608 - mh) / 2, mw, mh);
    const logoScale = Math.min(192 / logo.naturalWidth, 94 / logo.naturalHeight),
      logoWidth = logo.naturalWidth * logoScale,
      logoHeight = logo.naturalHeight * logoScale;
    ctx.drawImage(
      logo,
      878 + (192 - logoWidth) / 2,
      12 + (94 - logoHeight) / 2,
      logoWidth,
      logoHeight,
    );
    ctx.fillStyle = "#faf4e6";
    ctx.font = "700 13px Arial, sans-serif";
    ctx.textAlign = "right";
    const size = model.count <= 2 ? 160 : model.count <= 6 ? 144 : Math.min(112, Math.floor((478 - (Math.ceil(model.count / 2) - 1) * 8) / Math.ceil(model.count / 2)));
    const gap = model.count <= 4 ? 48 : 8,
      rowHeight = size + 42;
    let imageIndex = 0;
    model.rows.forEach((row, r) => {
      const width = row.length * size + (row.length - 1) * gap;
      const y = 304 - (model.rows.length * rowHeight) / 2 + r * rowHeight;
      row.forEach((player, column) => {
        const x = 590 + (478 - width) / 2 + column * (size + gap);
        ctx.drawImage(backgrounds[imageIndex], x, y, size, size);
        ctx.drawImage(
          avatars[imageIndex++],
          x + size * 0.15,
          y + size * 0.15,
          size * 0.7,
          size * 0.7,
        );
        if (player.winner) {
          ctx.save();
          ctx.translate(x + size * 0.23, y - 10);
          ctx.rotate(-Math.PI / 12);
          ctx.drawImage(
            crown,
            -size * 0.35,
            -size * 0.35,
            size * 0.7,
            size * 0.7,
          );
          ctx.restore();
        }
        const ribbonWidth = model.count === 5 || model.count === 6 ? 128 : size;
        const ribbonY = y + size * 0.78;
        ctx.drawImage(
          ribbon,
          x + (size - ribbonWidth) / 2,
          ribbonY,
          ribbonWidth,
          size * 0.31,
        );
        ctx.fillStyle = "#faf4e6";
        ctx.font = `${model.count >= 7 ? 18 : 22}px Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(String(player.score), x + size / 2, ribbonY + size * 0.2);
        ctx.font = `700 ${model.count >= 7 ? 15 : model.count >= 3 ? 18 : 21}px Arial, sans-serif`;
        const maxWidth = size + 8;
        let name = player.name;
        while (ctx.measureText(name).width > maxWidth && name.length > 1)
          name = name.slice(0, -1);
        if (name !== player.name) {
          while (
            ctx.measureText(name + "...").width > maxWidth &&
            name.length > 1
          )
            name = name.slice(0, -1);
          name += "...";
        }
        ctx.fillStyle = "#faf4e6";
        ctx.shadowColor = "rgba(0,0,0,.6)";
        ctx.shadowBlur = 3;
        ctx.fillText(name, x + size / 2, y + size + 32);
        ctx.shadowBlur = 0;
      });
    });
    ctx.fillStyle = "#193f38";
    ctx.fillRect(850, 568, 222, 32);
    ctx.drawImage(arrow, 858, 575, 19, 18);
    ctx.fillStyle = "#faf4e6";
    ctx.font = "700 16px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("ISLETOP", 881, 590);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (signal.aborted)
          reject(new DOMException("Image generation cancelled.", "AbortError"));
        else if (blob) resolve(blob);
        else reject(new Error("Unable to create the PNG. Please retry."));
      }, "image/png"),
    );
  } finally {
    URL.revokeObjectURL(boardUrl);
  }
}
