"use client";
import { MutableRefObject, useEffect, useRef } from "react";
import { Action, View } from "./game";
import { GOODS } from "./cities-knights";
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};
type ModelDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
export function useGameTools(
  game: MutableRefObject<View | null>,
  send: (a: Action) => Promise<boolean>,
) {
  const latest = useRef(send);
  latest.current = send;
  useEffect(() => {
    const context = (document as ModelDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const types = [
      "ready",
      "start",
      "roll",
      "voteRoll",
      "settlement",
      "road",
      "ship",
      "moveShip",
      "city",
      "buyDev",
      "robber",
      "pirate",
      "gold",
      "steal",
      "discard",
      "knight",
      "roadBuilding",
      "plenty",
      "monopoly",
      "skipRoads",
      "end",
      "pass",
      "bankTrade",
      "offer",
      "accept",
      "reject",
      "cancelOffer",
      "editOffer",
      "counterOffer",
      "prepareCounter",
      "completeTrade",
      "embargo",
      "tradePreference",
      "placeKnight",
      "activateKnight",
      "promoteKnight",
      "moveKnight",
      "displaceKnight",
      "chaseRobber",
      "chasePirate",
      "wall",
      "improve",
      "progress",
      "citiesChoice",
      "harborExchange",
    ];
    const handSchema = {
      type: "object",
      properties: Object.fromEntries(
        GOODS.map((r) => [r, { type: "integer", minimum: 0, maximum: 150 }]),
      ),
      required: ["wood", "brick", "sheep", "wheat", "ore"],
      additionalProperties: false,
    };
    const tools: Tool[] = [
      {
        name: "game_read_state",
        title: "Read game state",
        description:
          "Read your visible game state, including your private hand, current phase, and legal moves. Other players’ hands remain hidden.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => game.current,
      },
      {
        name: "game_submit_move",
        title: "Submit a game move",
        description:
          "Submit one move for your current seat using the same server rules and actions as the visible game. Read the game phase and legal moves first.",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: types },
            id: { type: "integer", minimum: 0 },
            cardId: { type: "integer", minimum: 0 },
            vertex: { type: ["integer", "null"], minimum: 0 },
            edge: { type: ["integer", "null"], minimum: 0 },
            tile: { type: "integer", minimum: 0 },
            tiles: {
              type: "array",
              items: { type: "integer", minimum: 0 },
              minItems: 2,
              maxItems: 2,
              uniqueItems: true,
            },
            knights: {
              type: "array",
              items: { type: "integer", minimum: 0 },
              minItems: 1,
              maxItems: 2,
              uniqueItems: true,
            },
            dice: {
              type: "array",
              items: { type: "integer", minimum: 1, maximum: 6 },
              minItems: 2,
              maxItems: 2,
            },
            track: { type: "string", enum: ["science", "trade", "politics"] },
            good: { type: "string", enum: GOODS },
            target: { type: "integer", minimum: 0 },
            resource: {
              type: "string",
              enum: ["wood", "brick", "sheep", "wheat", "ore"],
            },
            resources: handSchema,
            give: handSchema,
            want: handSchema,
            to: { type: ["integer", "null"], minimum: 0 },
            preparing: { type: "boolean" },
            blocked: { type: "boolean" },
            autoReject: { type: "boolean" },
            targets: {
              type: ["array", "null"],
              items: { type: "integer", minimum: 0 },
              uniqueItems: true,
            },
          },
          required: ["type"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: async (input) => {
          if (
            !input ||
            typeof input !== "object" ||
            !("type" in input) ||
            !types.includes(String(input.type))
          )
            throw new Error("Choose a supported game move.");
          if (!game.current || game.current.me < 0)
            throw new Error("Join a room first.");
          if (!(await latest.current(input as Action)))
            throw new Error(
              "The move was rejected. See the visible error for details.",
            );
          return {
            code: game.current.code,
            phase: game.current.phase,
            revision: game.current.revision,
            me: game.current.me,
          };
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch((e) => console.warn("Game tool unavailable", e));
      } catch (e) {
        console.warn("Game tool unavailable", e);
      }
    return () => lifecycle.abort();
  }, [game]);
}
