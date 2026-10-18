"use client";
import { useSyncExternalStore } from "react";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const current = () => location.search;
const server = () => "";
// Read the browser URL after hydration without copying it into effect state.
export function usePageSearch() {
  return useSyncExternalStore(subscribe, current, server);
}
