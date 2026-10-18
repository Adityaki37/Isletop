import { scrypt, timingSafeEqual } from "node:crypto";
export { usernameKey } from "./username";
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const randomToken = () =>
  hex(crypto.getRandomValues(new Uint8Array(32)));
export const tokenHash = async (value: string) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
export function validatePassword(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    [...value].length < 12 ||
    [...value].length > 128
  )
    throw new Error("Use a password of 12–128 characters.");
}
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export async function passwordHash(password: string) {
  validatePassword(password);
  const salt = randomToken();
  return `scrypt$16384$8$5$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: unknown, encoded: string) {
  if (typeof password !== "string" || [...password].length > 128) return false;
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join("$") !== "scrypt$16384$8$5" ||
    !/^[a-f0-9]{64}$/.test(parts[4]) ||
    !/^[a-f0-9]{64}$/.test(parts[5])
  )
    return false;
  return timingSafeEqual(
    await derive(password, parts[4]),
    Buffer.from(parts[5], "hex"),
  );
}
export function equalHash(a: string, b: string) {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export function cookieValue(req: Request, name: string) {
  return (
    req.headers
      .get("cookie")
      ?.match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`))?.[1] ??
    null
  );
}
export const sessionCookie = (
  req: Request,
  token: string,
  age = 2592000,
  name = "island_account",
) =>
  `${name}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
