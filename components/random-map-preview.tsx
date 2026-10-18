import { useMemo } from "react";
import { makeBaseBoard } from "@/lib/base-maps";

const colors = { wood: "#4c956c", brick: "#d47b55", sheep: "#92b76e", wheat: "#e4ba55", ore: "#91a7ad", desert: "#dfbb84", gold: "#f5c956", sea: "#9bc4b5" };
function previewBoard(players: number, seed: number) {
  let state = seed >>> 0;
  return makeBaseBoard(players, "baseRandom", () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export default function RandomMapPreview({ players, seed, width, height, label = "Randomized map example" }: { players: number; seed: number; width: number; height: number; label?: string }) {
  const board = useMemo(() => previewBoard(players, seed), [players, seed]);
  return <svg className="random-map-preview" role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${board.width} ${board.height}`}>
    <rect width={board.width} height={board.height} rx="18" fill="#b8d5c8" />
    {board.tiles.map(tile => <g key={tile.id} data-terrain={tile.resource}>
      <polygon points={tile.vertices.map(id => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} fill={colors[tile.resource]} stroke="#fff2d3" strokeWidth="2" />
      {!!tile.number && <><circle cx={tile.x} cy={tile.y} r="12" fill="#fff2d3" /><text x={tile.x} y={tile.y + 4} textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="700" fill={[6, 8].includes(tile.number) ? "#ad3a32" : "#193c47"}>{tile.number}</text></>}
    </g>)}
    {board.ports.map((port, i) => {
      const edge = board.edges[port.edge], a = board.vertices[edge.a], b = board.vertices[edge.b];
      return <circle key={i} cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="7" fill={port.resource === "any" ? "#fff2d3" : colors[port.resource]} stroke="#193c47" strokeWidth="2" />;
    })}
  </svg>;
}
