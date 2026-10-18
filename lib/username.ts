export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_ERROR =
  "Choose a username of 3–20 letters, numbers or underscores.";

// An ASCII allowlist keeps markup, encoded HTML and invisible characters out.
export function isValidUsername(value: string) {
  return (
    value.length >= USERNAME_MIN_LENGTH &&
    value.length <= USERNAME_MAX_LENGTH &&
    !/[^a-zA-Z0-9_]/.test(value)
  );
}

export function usernameKey(value: unknown) {
  if (typeof value !== "string" || !isValidUsername(value.trim()))
    throw new Error(USERNAME_ERROR);
  return value.trim().toLowerCase();
}
