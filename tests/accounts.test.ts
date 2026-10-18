import test from "node:test";
import assert from "node:assert/strict";
import {
  cookieValue,
  equalHash,
  passwordHash,
  randomToken,
  sessionCookie,
  tokenHash,
  usernameKey,
  validatePassword,
  verifyPassword,
} from "../lib/account-crypto";
import { GET as checkUsername } from "../app/api/accounts/username/route";
import { isValidUsername, USERNAME_ERROR } from "../lib/username";
test("password hashes use distinct salts and verify Unicode without truncation", async () => {
  const value = "A long passphrase 🐢 é 日本語",
    a = await passwordHash(value),
    b = await passwordHash(value);
  assert.notEqual(a, b);
  assert(!a.includes(value));
  assert(await verifyPassword(value, a));
  assert(!(await verifyPassword(value + "!", a)));
  assert(!(await verifyPassword(value, a.replace("16384", "1"))));
  assert(!(await verifyPassword("x".repeat(129), a)));
});
test("account names and passwords enforce bounds without weakening passwords", () => {
  assert.equal(usernameKey(" Player_One "), "player_one");
  assert.equal(usernameKey("A".repeat(20)), "a".repeat(20));
  for (const name of ["x", "a b", "a".repeat(21), null, "<script>"])
    assert.throws(() => usernameKey(name));
  for (const value of ["short", 123, "x".repeat(129)])
    assert.throws(() => validatePassword(value));
  validatePassword("🐢".repeat(12));
  validatePassword(" ".repeat(12));
});
test("username validation rejects markup, entities, invisible characters and oversized API requests", async () => {
  for (const value of [
    "a".repeat(21), "<script>x</script>", '<img src=x>',
    'a" onfocus="x', "&#60;script&#62;", "%3Cscript%3E",
    "player\u0000", "play\ner", "play\u200ber", "рlayer", "player😀",
  ]) {
    assert.equal(isValidUsername(value), false);
    assert.throws(() => usernameKey(value), { message: USERNAME_ERROR });
    const response = await checkUsername(new Request(
      `https://example.com/api/accounts/username?username=${encodeURIComponent(value)}`,
    ));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: USERNAME_ERROR });
  }
  assert.equal(isValidUsername("player\n"), false);
  assert.equal(usernameKey("  Player_123  "), "player_123");
});
test("random sessions and recovery codes are hashed and cookie flags fit their origin", async () => {
  const token = randomToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, randomToken());
  const hash = await tokenHash(token);
  assert.notEqual(hash, token);
  assert(equalHash(hash, await tokenHash(token)));
  assert(!equalHash(hash, token));
  assert(!equalHash("", hash));
  const https = new Request("https://example.com", {
    headers: { cookie: `other=x; island_account=${token}; z=y` },
  });
  assert.equal(cookieValue(https, "island_account"), token);
  assert.match(
    sessionCookie(https, token),
    /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/,
  );
  assert(
    !sessionCookie(new Request("http://localhost"), token).includes("Secure"),
  );
  assert.equal(
    cookieValue(
      new Request("http://localhost", {
        headers: { cookie: `island_account=${token}junk` },
      }),
      "island_account",
    ),
    null,
  );
});
