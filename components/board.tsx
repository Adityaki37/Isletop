"use client";
import { useId } from "react";
import { Board } from "@/lib/board";
import { PIECE_COLORS } from "@/lib/player-colors";
import { ASSETS, PLAYER_COLORS, TILE_NAMES } from "@/lib/assets";
import { CITIES_ASSETS } from "@/lib/cities-assets";
import type { View } from "@/lib/game";
export const RESOURCE_COLORS = {
  wood: "#4c956c",
  brick: "#d47b55",
  sheep: "#92b76e",
  wheat: "#e4ba55",
  ore: "#91a7ad",
  desert: "#dfbb84",
  sea: "#b8d5c8",
  gold: "#f5c956",
};
// Keep the tile artwork and number badges fixed; only position the robber.
const ROBBER_HEIGHT = 26;
const ROBBER_WIDTH = ROBBER_HEIGHT * 54.8 / 68.8;
function RobberMarker({ x, y, tokenOffset, preview = false }: { x: number; y: number; tokenOffset: number | null; preview?: boolean }) {
  const centerX = tokenOffset === null ? 0 : -25;
  const centerY = tokenOffset === null ? 5 : -12;
  return (
    <g data-robber-marker={preview ? "preview" : "placed"} role="img"
      aria-label={preview ? "Robber placement preview" : "Robber: blocks resource production"}
      pointerEvents="none" opacity={preview ? .65 : 1}>
      <svg x={x + centerX - ROBBER_WIDTH / 2} y={y + centerY - ROBBER_HEIGHT / 2} width={ROBBER_WIDTH} height={ROBBER_HEIGHT} viewBox="22.6 12.6 54.8 68.8" overflow="visible" aria-hidden="true">
        <image className="board-robber-art" href={ASSETS.icon_robber} width="100" height="100" />
      </svg>
    </g>
  );
}
export default function IslandBoard({
  board,
  onVertex,
  onEdge,
  onTile,
  legalVertices = [],
  legalEdges = [],
  robberMode = false,
  legalTiles,
  playerColors = [0, 1, 2, 3, 4, 5, 6, 7],
  selected,
  edgeLabel = "Build road",
  vertexLabel,
  tileLabel,
  markedVertices = [],
  markedTiles = [],
  cities,
}: {
  board: Board;
  onVertex?: (id: number, target: SVGElement) => void;
  onEdge?: (id: number, target: SVGElement) => void;
  onTile?: (id: number, target: SVGElement) => void;
  legalVertices?: number[];
  legalEdges?: number[];
  robberMode?: boolean;
  legalTiles?: number[];
  playerColors?: number[];
  selected?: { type: string; id?: number } | null;
  edgeLabel?: string;
  vertexLabel?: string;
  tileLabel?: string;
  markedVertices?: number[];
  markedTiles?: number[];
  cities?: View["cities"];
}) {
  const artworkId = useId();
  const points = (ids: number[]) => ids.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ");
  const coastline = board.edges.filter((edge) => edge.tiles.filter((id) => board.tiles[id].resource !== "sea" || board.tiles[id].fog).length === 1);
  const portDistance = board.tiles.some(tile => tile.resource === "sea") ? 62 : 86;
  const ports = board.ports.map((port) => {
    const edge = board.edges[port.edge], a = board.vertices[edge.a], b = board.vertices[edge.b];
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const adjacent = edge.tiles.map(id => board.tiles[id]);
    const sea = adjacent.find(tile => tile.resource === "sea");
    const land = adjacent.find(tile => tile.resource !== "sea") ?? adjacent[0];
    // The local shore normal keeps both docks equally exposed. Pointing away
    // from the whole board's center could hide one dock or cross another island.
    const dx = sea ? sea.x - x : x - land.x, dy = sea ? sea.y - y : y - land.y;
    const length = Math.hypot(dx, dy) || 1;
    // Leave enough exposed dock beyond both the shore marker and the sail.
    return { port, a, b, px: x + dx / length * portDistance, py: y + dy / length * portDistance };
  });
  // Adjacent port edges can put tall sails over one another. Spread only the
  // decorative ships; the docks still end at the original coastal vertices.
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
      const a = ports[i], b = ports[j], dx = b.px - a.px, dy = b.py - a.py;
      const overlapX = 66 - Math.abs(dx), overlapY = 90 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX < overlapY) {
        const shift = (overlapX / 2 + 1) * (dx >= 0 ? 1 : -1);
        a.px -= shift; b.px += shift;
      } else {
        const shift = (overlapY / 2 + 1) * (dy >= 0 ? 1 : -1);
        a.py -= shift; b.py += shift;
      }
      changed = true;
    }
    if (!changed) break;
  }
  // Fit decoration without moving any tiles, roads or placement targets.
  const left = Math.min(0, ...ports.map(p => p.px - 40)), top = Math.min(0, ...ports.map(p => p.py - 58));
  const right = Math.max(board.width, ...ports.map(p => p.px + 40)), bottom = Math.max(board.height, ...ports.map(p => p.py + 37));
  return (
    <svg
      className="island"
      viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
      aria-label="Island game board"
    >
      <defs>
        {board.tiles.map((tile) => <clipPath key={tile.id} id={`${artworkId}-hex-${tile.id}`}><polygon points={points(tile.vertices)} /></clipPath>)}
      </defs>
      {board.tiles.filter((tile) => tile.resource === "sea" && !tile.fog).map((tile) => <polygon key={tile.id} points={points(tile.vertices)} fill="var(--board-ocean, #b8d5c8)" stroke="#83b2a044" strokeWidth="1" pointerEvents="none" />)}
      <g aria-hidden="true" pointerEvents="none" strokeLinecap="round">
        {coastline.map((edge) => {
          const a = board.vertices[edge.a], b = board.vertices[edge.b];
          return <g key={edge.id} data-coast-edge={edge.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#71bedb" strokeWidth="18" /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f6dfaa" strokeWidth="11" /></g>;
        })}
      </g>
      {board.tiles.map((t) => {
        const tokenX = t.x;
        const tokenY = t.y + 10;
        const pipCount = 6 - Math.abs(7 - t.number);
        const canRob =
          robberMode &&
          (
            legalTiles ??
            board.tiles
              .filter((tile) => tile.id !== board.robber)
              .map((tile) => tile.id)
          ).includes(t.id);
        return (
          <g
            key={t.id}
            role={canRob ? "button" : undefined}
            tabIndex={canRob ? 0 : undefined}
            aria-label={
              t.fog
                ? `Unexplored fog tile ${t.id}`
                : canRob && tileLabel
                  ? `${tileLabel} ${t.id}: ${TILE_NAMES[t.resource]} ${t.number}`
                  : canRob && t.resource === "sea"
                    ? `Move pirate to sea tile ${t.id}`
                    : `${TILE_NAMES[t.resource]} ${t.number}${board.robber === t.id ? " robber" : ""}`
            }
            onClick={canRob ? (event) => onTile?.(t.id, event.currentTarget) : undefined}
            onKeyDown={
              canRob
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onTile?.(t.id, e.currentTarget);
                    }
                  }
                : undefined
            }
            className={canRob ? "tile selectable" : "tile"}
            data-board-tile={t.id}
          >
            <title>
              {t.fog
                ? "Unexplored tile: reach it with a road or ship to reveal it"
                : t.resource === "sea"
                  ? "Sea: no resource production"
                  : `${TILE_NAMES[t.resource]}${t.number ? ` produces when ${t.number} is rolled` : ": no production"}${board.robber === t.id ? "; blocked by the robber" : ""}`}
            </title>
            {(t.fog || t.resource !== "sea") && <polygon points={points(t.vertices)} fill={t.fog ? "#879da7" : RESOURCE_COLORS[t.resource]} data-terrain-hex={t.id} pointerEvents="none" />}
            {t.fog ? (
              <image
                href={ASSETS.tile_fog}
                x={t.x - (48 * Math.sqrt(3) / .84) / 2}
                y={t.y - 50}
                width={48 * Math.sqrt(3) / .84}
                height="100"
                preserveAspectRatio="none"
                clipPath={`url(#${artworkId}-hex-${t.id})`}
              />
            ) : t.resource === "sea" ? (
              <polygon
                points={t.vertices
                  .map(
                    (id) => `${board.vertices[id].x},${board.vertices[id].y}`,
                  )
                  .join(" ")}
                fill="transparent"
                stroke="transparent"
                strokeWidth="1"
              />
            ) : (
              <image
                href={ASSETS[`generated_tile_${TILE_NAMES[t.resource]}`]}
                x={t.x - (48 * Math.sqrt(3) / .84) / 2}
                y={t.y - 50}
                width={48 * Math.sqrt(3) / .84}
                height="100"
                preserveAspectRatio="none"
                clipPath={`url(#${artworkId}-hex-${t.id})`}
              />
            )}
            {t.number > 0 && (
              <g data-number-token={t.id} pointerEvents="none">
                <circle
                  cx={tokenX}
                  cy={tokenY}
                  r="16"
                  fill="#fff7e4"
                  stroke="#c5a976"
                  strokeWidth="1.5"
                />
                <text
                  x={tokenX}
                  y={tokenY + 3}
                  textAnchor="middle"
                  fontSize="19"
                  fontWeight="800"
                  fill={[6, 8].includes(t.number) ? "#bd332b" : "#243e36"}
                >
                  {t.number}
                </text>
                {Array.from({ length: pipCount }, (_, i) => (
                  <circle
                    key={i}
                    data-probability-dot=""
                    cx={tokenX + (i - (pipCount - 1) / 2) * 4.5}
                    cy={tokenY + 10}
                    r="1.6"
                    fill={[6, 8].includes(t.number) ? "#bd332b" : "#243e36"}
                  />
                ))}
              </g>
            )}
            {board.robber === t.id && (
              <RobberMarker x={t.x} y={t.y} tokenOffset={t.number > 0 ? tokenY - t.y : null} />
            )}
            {board.pirate === t.id && (
              <image
                href={ASSETS.icon_pirate_ship}
                x={t.x - 18}
                y={t.y - 23}
                width="36"
                height="40"
              />
            )}
            {cities?.merchant?.tile === t.id && (
              <image
                href={
                  CITIES_ASSETS[
                    `icon_merchant_${PLAYER_COLORS[playerColors[cities.merchant.owner]]}`
                  ]
                }
                x={t.x - 40}
                y={t.y - 21}
                width="25"
                height="31"
                role="img"
                aria-label={`Merchant of player ${cities.merchant.owner + 1}`}
              />
            )}
            {selected?.type === "pirate" && selected.id === t.id && (
              <image
                href={ASSETS.icon_pirate_ship}
                x={t.x - 18}
                y={t.y - 23}
                width="36"
                height="40"
                opacity=".65"
              />
            )}
            {selected?.type === "robber" && selected.id === t.id && (
              <RobberMarker x={t.x} y={t.y} tokenOffset={t.number > 0 ? tokenY - t.y : null} preview />
            )}
            {canRob && (<>
              <polygon
                points={t.vertices
                  .map(
                    (id) => `${board.vertices[id].x},${board.vertices[id].y}`,
                  )
                  .join(" ")}
                fill={selected?.id === t.id ? "#ffcf4933" : "transparent"}
                stroke={
                  markedTiles.includes(t.id) ||
                  (["robber", "pirate"].includes(selected?.type ?? "") &&
                    selected?.id === t.id)
                    ? "#ffae00"
                    : "transparent"
                }
                strokeWidth="4"
                className="robber-target"
              />
              <circle className="robber-spot" cx={t.x} cy={t.y - 28} r="9" fill="#fce96dcc" stroke="#6b7c35" strokeWidth="2" pointerEvents="none" />
            </>)}
          </g>
        );
      })}
      {ports.map(({ port: p, a, b, px, py }, i) => {
        const label = p.resource === "any" ? "3:1 any resource" : `2:1 ${TILE_NAMES[p.resource]}`;
        return (
          <g key={i} data-trade-port={p.edge} role="img" aria-label={`Trade ship: ${label}`} pointerEvents="none">
            <title>{label} port — build at either connected coastal intersection</title>
            {[a, b].map((vertex) => {
              const length = Math.hypot(px - vertex.x, py - vertex.y),
                angle = Math.atan2(py - vertex.y, px - vertex.x) * 180 / Math.PI;
              return <g key={vertex.id} data-port-bridge={vertex.id} transform={`translate(${vertex.x} ${vertex.y}) rotate(${angle})`} aria-hidden="true">
                <rect x="0" y="-8" width={length} height="16" rx="2" fill="#ffe7ae" stroke="#173e37" strokeWidth="3" />
                {Array.from({length: Math.floor(length / 6)}, (_, plank) => <line key={plank} x1={(plank + 1) * 6} y1="-6" x2={(plank + 1) * 6} y2="6" stroke="#98602d" strokeWidth="2" />)}
                <path d={`M2 -6H${length - 2}M2 6H${length - 2}`} fill="none" stroke="#fff7d8" strokeWidth="2" />
              </g>;
            })}
            <g transform={`translate(${px} ${py})`} data-port-ship={p.edge}>
              <path d="M-26 27Q0 35 26 27" fill="none" stroke="#d4ebe0" strokeWidth="3" strokeLinecap="round" />
              <path d="M23 -52V12" stroke="#674527" strokeWidth="3" />
              <path d="M23 -51H36L23 -44Z" fill="#e8bd68" stroke="#674527" strokeWidth="1" />
              <path data-port-sail="true" d="M-24 -45Q0 -52 24 -45L27 9Q0 6 -27 9Z" fill="#fff8e7" stroke="#674527" strokeWidth="1.8" />
              {p.resource === "any" ? <text x="0" y="-17" textAnchor="middle" fill="#173e37" fontSize="23" fontWeight="800">?</text> : <image href={ASSETS[`card_${TILE_NAMES[p.resource]}`]} x="-10" y="-39" width="20" height="27" />}
              <text x="0" y="3" textAnchor="middle" fill="#173e37" fontSize="16" fontWeight="800">{p.resource === "any" ? "3:1" : "2:1"}</text>
              <path d="M-25 11H25L15 25H-15Z" fill="#b8783f" stroke="#563d26" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M-19 15H19" stroke="#f1cf88" strokeWidth="2" />
            </g>
          </g>
        );
      })}
      {board.edges.map((e) => {
        const a = board.vertices[e.a],
          b = board.vertices[e.b],
          legal = legalEdges.includes(e.id),
          x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2,
          length = Math.hypot(b.x - a.x, b.y - a.y),
          dx = (b.x - a.x) / length,
          dy = (b.y - a.y) / length,
          angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - 90;
        return (
          <g key={e.id}>
            {e.owner !== null && e.kind !== "ship" && (
              <g
                aria-label={`Player ${e.owner + 1} road ${e.id}`}
                role="img"
                pointerEvents="none"
              >
                <line
                  x1={a.x + dx * 7}
                  y1={a.y + dy * 7}
                  x2={b.x - dx * 7}
                  y2={b.y - dy * 7}
                  stroke="#193c47"
                  strokeWidth="11"
                  strokeLinecap="round"
                />
                <line
                  x1={a.x + dx * 7}
                  y1={a.y + dy * 7}
                  x2={b.x - dx * 7}
                  y2={b.y - dy * 7}
                  stroke={
                    PIECE_COLORS[playerColors[e.owner]]
                  }
                  strokeWidth="7.5"
                  strokeLinecap="round"
                />
              </g>
            )}
            {e.owner !== null && e.kind === "ship" && (
              <image
                href={
                  ASSETS[
                    e.kind === "ship"
                      ? `ship_${PLAYER_COLORS[playerColors[e.owner]]}_north_west`
                      : `road_${PLAYER_COLORS[playerColors[e.owner]]}`
                  ]
                }
                x={x - (e.kind === "ship" ? 18 : 4.5)}
                y={y - (e.kind === "ship" ? 18 : 22)}
                width={e.kind === "ship" ? 36 : 9}
                height={e.kind === "ship" ? 36 : 44}
                transform={`rotate(${e.kind === "ship" ? angle + 30 : angle} ${x} ${y})`}
              />
            )}{" "}
            {legal && (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={
                  ["road", "ship", "moveShip"].includes(selected?.type ?? "") &&
                  selected?.id === e.id
                    ? "#ffae00"
                    : "#ffec45"
                }
                strokeWidth="7"
                strokeLinecap="round"
              />
            )}
            {legal && (
              <polygon
                points={`${a.x - dy * 11},${a.y + dx * 11} ${b.x - dy * 11},${b.y + dx * 11} ${b.x + dy * 11},${b.y - dx * 11} ${a.x + dy * 11},${a.y - dx * 11}`}
                fill="transparent"
                data-road-hit-target={e.id}
                className="selectable"
                role="button"
                tabIndex={0}
                aria-label={`${edgeLabel} ${e.id}`}
                onClick={(event) => onEdge?.(e.id, event.currentTarget)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onEdge?.(e.id, ev.currentTarget);
                  }
                }}
              />
            )}
          </g>
        );
      })}
      {board.vertices.map((v) => {
        const legal = legalVertices.includes(v.id);
        const knight = cities?.knights.find((k) => k.vertex === v.id);
        const metropolis =
          cities &&
          (["science", "trade", "politics"] as const).find(
            (track) => cities.metropolises[track]?.vertex === v.id,
          );
        return (
          <g
            key={v.id}
            className={legal ? "selectable" : ""}
            onClick={legal ? (event) => onVertex?.(v.id, event.currentTarget) : undefined}
            role={legal ? "button" : undefined}
            tabIndex={legal ? 0 : undefined}
            aria-label={
              legal
                ? `${vertexLabel ?? `Build ${v.owner === null ? "settlement" : "city"}`} ${v.id}`
                : undefined
            }
            onKeyDown={
              legal
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onVertex?.(v.id, e.currentTarget);
                    }
                  }
                : undefined
            }
          >
            {v.owner !== null && cities?.walls.includes(v.id) && (
              <image
                href={
                  CITIES_ASSETS[
                    `city_wall_${PLAYER_COLORS[playerColors[v.owner]]}`
                  ]
                }
                x={v.x - 21}
                y={v.y - 14}
                width="42"
                height="25"
                role="img"
                aria-label={`City wall ${v.id}`}
              />
            )}
            {v.owner !== null && (
              <image
                href={
                  ASSETS[
                    `${v.city ? "city" : "settlement"}_${PLAYER_COLORS[playerColors[v.owner]]}`
                  ]
                }
                x={v.x - (v.city ? 16 : 13)}
                y={v.y - 24}
                width={v.city ? 32 : 26}
                height="32"
                role="img"
                aria-label={`Player ${v.owner + 1} ${v.city ? "city" : "settlement"} ${v.id}${metropolis ? ` (${metropolis} metropolis)` : ""}`}
              />
            )}
            {knight && (
              <image
                href={
                  CITIES_ASSETS[
                    `knight_level${knight.level}_${knight.active ? "active" : "inactive"}_${PLAYER_COLORS[playerColors[knight.owner]]}`
                  ]
                }
                x={v.x - 15}
                y={v.y - 18}
                width="30"
                height="30"
                role="img"
                aria-label={`Player ${knight.owner + 1} level ${knight.level} ${knight.active ? "active" : "inactive"} knight ${v.id}`}
              />
            )}
            {legal && (
              <circle
                cx={v.x}
                cy={v.y}
                r="11"
                fill={
                  markedVertices.includes(v.id) ||
                  (selected?.id === v.id &&
                    ["settlement", "city"].includes(selected.type))
                    ? "#ffae00"
                    : "#ffe44a"
                }
                stroke="#5d713b"
                strokeWidth="2"
                fillOpacity={knight || v.owner !== null ? ".35" : ".9"}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
