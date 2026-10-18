import assert from "node:assert/strict";
import { Game, total, points } from "../lib/game";
import { RESOURCE_METRICS } from "../lib/match-statistics";
export function assertStatistics(g: Game) {
  assert(g.statistics?.complete && g.statistics.detailed);
  g.players.forEach((player, seat) => {
    const row = g.statistics!.players[seat];
    assert.equal(Object.values(row.received).reduce((sum, n) => sum + n, 0), row.resources.totalResourceIncome);
    assert.equal(Object.values(row.spent).reduce((sum, n) => sum + n, 0), row.activity.resourcesUsed);
    for (const suffix of ["Income", "Loss"] as const)
      assert.equal(RESOURCE_METRICS.filter(([key]) => key.endsWith(suffix) && !key.startsWith("total")).reduce((sum, [key]) => sum + row.resources[key], 0), row.resources[`totalResource${suffix}`]);
    assert.equal(
      row.resources.totalResourceIncome -
        row.resources.totalResourceLoss -
        row.activity.resourcesUsed,
      total(player.hand),
      "Statistics reconcile with the actual hand.",
    );
    assert.equal(
      row.activity.devCardsBought - row.activity.devCardsUsed +
        (row.activity.progressCardsStolen ?? 0) -
        (row.activity.progressCardsLost ?? 0) -
        (row.activity.progressCardsDiscarded ?? 0),
      g.cities ? g.cities.players[seat].progress.length + g.cities.players[seat].revealed.length : player.dev.length,
      "Card draws, plays, transfers and discards reconcile with holdings.",
    );
  });
  assert.deepEqual(
    g.statistics.points.at(-1)!.scores,
    g.players.map((_, seat) => points(g, seat)),
  );
}
