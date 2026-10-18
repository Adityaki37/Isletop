"use client";

import { useEffect } from "react";

export function startIsletopTitleReminder(needsAttention: boolean, environment: { document: Document; window: Window } = { document, window }) {
    const { document: page, window: browser } = environment;
    let timer: ReturnType<typeof setInterval> | undefined;
    const motion = browser.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      const away = page.hidden || !page.hasFocus();
      page.title = needsAttention && away ? "Your Turn — Isletop" : "Isletop";
      if (needsAttention && away && !motion.matches) {
        let reminder = true;
        timer = setInterval(() => {
          reminder = !reminder;
          page.title = reminder ? "Your Turn — Isletop" : "Isletop";
        }, 1000);
      }
    };
    update();
    page.addEventListener("visibilitychange", update);
    browser.addEventListener("focus", update);
    browser.addEventListener("blur", update);
    motion.addEventListener("change", update);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      page.removeEventListener("visibilitychange", update);
      browser.removeEventListener("focus", update);
      browser.removeEventListener("blur", update);
      motion.removeEventListener("change", update);
      page.title = "Isletop";
    };
}

export function useIsletopTitle(needsAttention: boolean) {
  useEffect(() => startIsletopTitleReminder(needsAttention), [needsAttention]);
}
