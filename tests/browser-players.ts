import { createInterface } from "node:readline";
import { chooseMove } from "./autoplay";
import { citiesCandidates } from "./cities-match-driver";
import { Game, View, actor } from "../lib/game";
import { emptyHand } from "../lib/board";
const base = "http://127.0.0.1:5173",
  code = process.argv[2];
const seats: { cookie: string }[] = [{ cookie: "" }];
async function request(seat: { cookie: string }, body: unknown = null) {
  const response = await fetch(
    `${base}/api/rooms${body ? "" : `?code=${code}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        ...(seat.cookie ? { Cookie: seat.cookie } : {}),
        ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const cookie = response.headers.get("set-cookie");
  if (cookie) seat.cookie = cookie.split(";")[0];
  const r = (await response.json()) as { game: View; error?: string };
  if (!response.ok) throw new Error(r.error);
  return r.game;
}
const initial = await request(seats[0]);
for (let i = 1; i < initial.capacity; i++) {
  const seat = { cookie: "" };
  seats.push(seat);
  await request(seat, {
    op: "join",
    code,
    name: ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"][i - 1],
  });
  await request(seat, {
    op: "action",
    code,
    nonce: crypto.randomUUID(),
    action: { type: "ready" },
  });
}
console.log("Preview players joined and ready.");
const rl = createInterface({ input: process.stdin });
for await (const command of rl) {
  if (command.trim() === "quit") {
    rl.close();
    break;
  }
  if (command.trim().startsWith("{")) {
    const { seat, action } = JSON.parse(command) as {
      seat: number;
      action: unknown;
    };
    if (!seats[seat] || seat === 0)
      throw new Error("Choose a joined preview seat.");
    const next = await request(seats[seat], {
      op: "action",
      code,
      nonce: crypto.randomUUID(),
      action,
    });
    console.log(
      `Seat ${seat} action completed; ${next.offers.length} offers visible.`,
    );
    continue;
  }
  const parts = command.trim().split(" ");
  if (["accept", "reject", "counter"].includes(parts[0])) {
    const p = Number(parts[1]),
      id = Number(parts[2]);
    if (!seats[p] || p === 0 || !Number.isInteger(id))
      throw new Error("Choose a joined test seat and offer ID.");
    const action =
      parts[0] === "counter"
        ? {
            type: "counterOffer",
            id,
            give: { ...emptyHand(), brick: 1 },
            want: { ...emptyHand(), wood: 1 },
          }
        : { type: parts[0], id };
    const next = await request(seats[p], {
      op: "action",
      code,
      nonce: crypto.randomUUID(),
      action,
    });
    console.log(
      `Seat ${p} ${parts[0]} offer ${id}; ${next.offers.length} offers visible.`,
    );
  }
  if (command.trim() === "advance") {
    let g = await request(seats[0]);
    for (let step = 0; step < 200; step++) {
      const p =
        g.phase === "discard"
          ? Number(Object.keys(g.discards).find((i) => Number(i) !== 0) ?? 0)
          : g.phase === "gold"
            ? Number(
                Object.keys(g.goldClaims).find((i) => Number(i) !== 0) ?? 0,
              )
            : actor(g as unknown as Game);
      if (p === 0 || g.phase === "finished" || g.phase === "lobby") break;
      const mine = await request(seats[p]);
      const proxy = {
        ...mine,
        players: mine.players.map((pl) => ({
          ...pl,
          hand: pl.hand ?? { ...emptyHand(), wood: pl.resources },
          dev: pl.dev ?? [],
        })),
        deck: Array(mine.deckCount).fill("knight"),
        receipts: [],
      } as unknown as Game;
      const action =
        mine.mode === "citiesKnights"
          ? citiesCandidates(mine)[0]
          : chooseMove(proxy, p);
      if (!action) break;
      g = await request(seats[p], {
        op: "action",
        code,
        nonce: crypto.randomUUID(),
        action,
      });
    }
    console.log(
      `Preview at ${g.phase}, active seat ${actor(g as unknown as Game)}, turn ${g.turn}.`,
    );
  }
}
