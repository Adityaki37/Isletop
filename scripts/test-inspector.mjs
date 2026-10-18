// Wrangler's local inspector buffers runtime/network events when no debugger
// consumes them. Sustained match tests attach one consumer and turn off network
// recording. This changes local diagnostics only; it never changes game state.
import { WebSocket } from "ws";

export async function attachTestInspector(origin) {
  if (!origin) return null;
  const endpoint = new URL(origin);
  const local = (url) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (endpoint.protocol !== "http:" || !local(endpoint))
    throw new Error("The test inspector must be a local HTTP endpoint.");
  const response = await fetch(new URL("/json/list", endpoint), {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Inspector HTTP ${response.status}`);
  const [target] = await response.json();
  const debuggerUrl = new URL(target?.webSocketDebuggerUrl);
  if (debuggerUrl.protocol !== "ws:" || !local(debuggerUrl))
    throw new Error("The inspector must expose a local WebSocket.");
  const socket = new WebSocket(debuggerUrl, {
    headers: { Origin: endpoint.origin },
  });
  const waiting = new Map();
  let sequence = 0;
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  });
  const rejected = (error) => {
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    waiting.clear();
  };
  socket.on("error", rejected);
  socket.on("close", () =>
    rejected(new Error("The local inspector disconnected.")),
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(
        new Error("Inspector connection timed out; restart the local worker."),
      );
    }, 5000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const call = (method) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`Inspector ${method} timed out.`));
      }, 10000);
      waiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method }));
    });
  try {
    await call("Network.disable");
  } catch (error) {
    socket.close();
    throw error;
  }
  console.log(
    "Local inspector attached; network recording disabled for sustained tests.",
  );
  return {
    close: () => socket.close(),
    heap: () => call("Runtime.getHeapUsage"),
  };
}
