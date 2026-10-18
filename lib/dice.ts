import { secureRandom } from "./board";

export type DiceMode = "random" | "balanced";
export type BalancedDiceState = {
  pairs: [number, number][];
  recent: number[];
  sevens: Record<number, number>;
  lastSeven: number | null;
  streak: number;
};

function deck(): [number, number][] {
  return Array.from({ length: 36 }, (_, i) => [1 + Math.floor(i / 6), 1 + i % 6]);
}
export function createBalancedDice(): BalancedDiceState {
  return { pairs: deck(), recent: [], sevens: {}, lastSeven: null, streak: 0 };
}

// Balanced-dice algorithm reference: https://pastebin.com/wWH4Ka96
// Keep this state private: remaining pairs reveal information about future rolls.
export function balancedWeights(state: BalancedDiceState, seat: number, players: number) {
  const weights = Array(13).fill(0) as number[];
  for (const [a, b] of state.pairs) weights[a + b] += 1 / state.pairs.length;
  for (let sum = 2; sum <= 12; sum++) {
    const repeats = state.recent.filter((n) => n === sum).length;
    weights[sum] *= Math.max(0, 1 - 0.34 * repeats);
  }
  if (players >= 2) {
    const known = { ...state.sevens, [seat]: state.sevens[seat] ?? 0 };
    const count = Object.keys(known).length;
    const total = Object.values(known).reduce((n, rolls) => n + rolls, 0);
    const imbalance = total < count ? 1 : 2 - count * known[seat] / total;
    const streak = 0.4 * state.streak * (state.lastSeven === seat ? -1 : 1);
    weights[7] *= Math.max(0, Math.min(2, imbalance + streak));
  }
  return weights;
}

export function drawBalancedDice(state: BalancedDiceState, seat: number, players: number, rng = secureRandom): number[] {
  if (state.pairs.length < 13) state.pairs = deck();
  state.sevens[seat] ??= 0;
  const weights = balancedWeights(state, seat, players);
  let cursor = rng() * weights.reduce((n, weight) => n + weight, 0);
  let sum = 12;
  for (let n = 2; n <= 12; n++) {
    if (weights[n] > 0 && cursor < weights[n]) { sum = n; break; }
    cursor -= weights[n];
  }
  const candidates = state.pairs.flatMap(([a, b], i) => a + b === sum ? [i] : []);
  const index = candidates[Math.floor(rng() * candidates.length)];
  const pair = state.pairs.splice(index, 1)[0];
  state.recent.push(sum);
  state.recent = state.recent.slice(-5);
  if (sum === 7) {
    state.sevens[seat]++;
    state.streak = state.lastSeven === seat ? state.streak + 1 : 1;
    state.lastSeven = seat;
  }
  return pair;
}
