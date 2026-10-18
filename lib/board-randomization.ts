import { Board, RESOURCES, secureRandom, shuffle } from "./board";

// Geography, islands, fog, gold, deserts and coastal anchors define a scenario.
// Shuffle its variable contents without changing those gameplay boundaries.
export function randomizeScenarioBoard(
  board: Board,
  rng = secureRandom,
): Board {
  const groups = new Map<number, typeof board.tiles>();
  for (const tile of board.tiles) {
    if (
      tile.fog ||
      !RESOURCES.includes(tile.resource as (typeof RESOURCES)[number])
    )
      continue;
    const region = tile.island ?? 0;
    const group = groups.get(region) ?? [];
    group.push(tile);
    groups.set(region, group);
  }
  for (const group of groups.values()) {
    const terrain = shuffle(
      group.map((t) => t.resource),
      rng,
    );
    group.forEach((tile, i) => {
      tile.resource = terrain[i];
    });
  }
  const productive = board.tiles.filter((t) => !t.fog && t.number > 0);
  const red = shuffle(
    productive.map((t) => t.number).filter((n) => n === 6 || n === 8),
    rng,
  );
  const other = shuffle(
    productive.map((t) => t.number).filter((n) => n !== 6 && n !== 8),
    rng,
  );
  const neighbors = new Map(board.tiles.map((t) => [t.id, new Set<number>()]));
  for (const edge of board.edges)
    if (edge.tiles.length === 2) {
      neighbors.get(edge.tiles[0])!.add(edge.tiles[1]);
      neighbors.get(edge.tiles[1])!.add(edge.tiles[0]);
    }
  function spaced(candidates: number[], selected: number[]): number[] | null {
    if (selected.length === red.length) return selected;
    if (candidates.length < red.length - selected.length) return null;
    const [first, ...rest] = candidates;
    if (first === undefined) return null;
    return (
      spaced(
        rest.filter((id) => !neighbors.get(first)!.has(id)),
        [...selected, first],
      ) ?? spaced(rest, selected)
    );
  }
  const positions = spaced(
    shuffle(
      productive.map((t) => t.id),
      rng,
    ),
    [],
  );
  if (!positions)
    throw new Error("This scenario cannot separate its 6 and 8 tokens.");
  const reds = new Set(positions);
  for (const tile of productive)
    tile.number = reds.has(tile.id) ? red.pop()! : other.pop()!;
  const ports = shuffle(
    board.ports.map((p) => p.resource),
    rng,
  );
  board.ports.forEach((port, i) => {
    port.resource = ports[i];
  });
  return board;
}
