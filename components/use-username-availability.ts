"use client";
import { useEffect, useState } from "react";
import { isValidUsername, USERNAME_ERROR } from "@/lib/username";

type Check = { key: string; status: "available" | "taken" | "error" };

export function useUsernameAvailability(
  value: string,
  currentUsername = "",
  enabled = true,
) {
  const key = value.trim().toLowerCase();
  const current = currentUsername.toLowerCase();
  const valid = isValidUsername(key);
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    if (!enabled || !valid || key === current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/accounts/username?username=${encodeURIComponent(key)}`,
            {
              cache: "no-store",
              signal: controller.signal,
            },
          );
          const result = (await response.json()) as { available?: boolean };
          if (!response.ok || typeof result.available !== "boolean")
            throw new Error();
          if (!controller.signal.aborted)
            setCheck({ key, status: result.available ? "available" : "taken" });
        } catch {
          if (!controller.signal.aborted) setCheck({ key, status: "error" });
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, current, valid, enabled]);

  const status = !enabled
    ? "idle"
    : !valid
      ? "invalid"
      : key === current
        ? "available"
        : check?.key === key
          ? check.status
          : "checking";
  const message =
    status === "taken"
      ? "That username is already taken. Choose a different username."
      : status === "checking"
        ? "Checking username…"
        : status === "invalid" && value
          ? USERNAME_ERROR
          : status === "available" && key !== current
            ? "Username is available."
            : status === "error"
              ? "Unable to check availability. We'll check when you save."
              : "";
  return {
    status,
    message,
    canSubmit: status === "available" || status === "error",
    invalid: status === "taken" || status === "invalid",
    markTaken: (submitted: string) =>
      setCheck({ key: submitted.trim().toLowerCase(), status: "taken" }),
  };
}
