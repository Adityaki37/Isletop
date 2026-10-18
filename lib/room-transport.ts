export class RoomNetworkError extends Error {}
export async function roomRequest<T>(
  url: string,
  init: RequestInit = {},
  retryMove = false,
): Promise<T> {
  for (let attempt = 0; attempt < (retryMove ? 2 : 1); attempt++) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new RoomNetworkError(
        "You’re offline. Reconnect to resume the table.",
      );
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
      });
      let data: T & { error?: string };
      try {
        data = await response.json();
      } catch {
        throw new RoomNetworkError(
          "The table’s response was interrupted. Reconnecting…",
        );
      }
      if (!response.ok) {
        const reference = response.headers.get("X-Request-ID");
        const suffix =
          response.status >= 500 &&
          reference &&
          /^[a-f0-9-]{36}$/.test(reference)
            ? ` Reference ${reference.slice(0, 8)}.`
            : "";
        throw new Error((data.error ?? "Unable to update the table.") + suffix);
      }
      return data;
    } catch (e) {
      const network =
        e instanceof RoomNetworkError ||
        (e instanceof Error &&
          ["TypeError", "TimeoutError", "AbortError"].includes(e.name));
      if (!network) throw e;
      if (init.signal?.aborted) throw e;
      if (retryMove && attempt === 0) continue;
      throw new RoomNetworkError("Connection lost. Reconnecting…");
    }
  }
  throw new RoomNetworkError("Connection lost. Reconnecting…");
}
