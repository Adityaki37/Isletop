type OrderedSeats = { players: readonly unknown[]; turnOrder?: number[] };

// Seat identities stay fixed; only the order of their turns changes.
export function seatsInTurnOrder(game: OrderedSeats): number[] {
  const order = game.turnOrder;
  return order &&
    order.length === game.players.length &&
    new Set(order).size === order.length &&
    order.every(
      (seat) =>
        Number.isInteger(seat) && seat >= 0 && seat < game.players.length,
    )
    ? [...order]
    : game.players.map((_, seat) => seat);
}

export function seatsAfter(game: OrderedSeats, seat: number): number[] {
  const order = seatsInTurnOrder(game),
    position = order.indexOf(seat);
  return [...order.slice(position + 1), ...order.slice(0, position)];
}

export function nextTurnSeat(game: OrderedSeats, seat: number): number {
  return seatsAfter(game, seat)[0] ?? seat;
}
