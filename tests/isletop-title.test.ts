import assert from "node:assert/strict";
import test from "node:test";
import { startIsletopTitleReminder } from "../components/use-isletop-title";

function browserFixture() {
  let focused = true;
  const page = Object.assign(new EventTarget(), {title: "Isletop", hidden: false, hasFocus: () => focused});
  const motion = Object.assign(new EventTarget(), {matches: false});
  const browser = Object.assign(new EventTarget(), {matchMedia: () => motion});
  return {
    page, motion,
    environment: {document: page as unknown as Document, window: browser as unknown as Window},
    blur() {focused = false; browser.dispatchEvent(new Event("blur"));},
    focus() {focused = true; browser.dispatchEvent(new Event("focus"));},
    hide() {page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));},
  };
}

test("an active turn flashes away, then restores Isletop on focus and cleanup", async (t) => {
  const f = browserFixture();
  t.mock.timers.enable({apis: ["setInterval"]});
  const stop = startIsletopTitleReminder(true, f.environment);
  assert.equal(f.page.title, "Isletop");
  f.blur();
  assert.equal(f.page.title, "Your Turn — Isletop");
  t.mock.timers.tick(1000);
  assert.equal(f.page.title, "Isletop");
  t.mock.timers.tick(1000);
  assert.equal(f.page.title, "Your Turn — Isletop");
  f.focus();
  t.mock.timers.tick(3000);
  assert.equal(f.page.title, "Isletop");
  f.hide();
  assert.equal(f.page.title, "Your Turn — Isletop");
  stop();
  t.mock.timers.tick(3000);
  assert.equal(f.page.title, "Isletop");
  f.blur();
  assert.equal(f.page.title, "Isletop", "listeners are removed on cleanup");
});

test("waiting, spectators and ended turns keep the normal title", (t) => {
  const f = browserFixture();
  t.mock.timers.enable({apis: ["setInterval"]});
  const stop = startIsletopTitleReminder(false, f.environment);
  f.hide(); f.blur();
  t.mock.timers.tick(5000);
  assert.equal(f.page.title, "Isletop");
  stop();
});

test("reduced motion uses a steady reminder and responds to preference changes", (t) => {
  const f = browserFixture();
  t.mock.timers.enable({apis: ["setInterval"]});
  f.motion.matches = true; f.blur();
  const stop = startIsletopTitleReminder(true, f.environment);
  t.mock.timers.tick(1000);
  assert.equal(f.page.title, "Your Turn — Isletop");
  f.motion.matches = false; f.motion.dispatchEvent(new Event("change"));
  t.mock.timers.tick(1000);
  assert.equal(f.page.title, "Isletop");
  stop();
});
