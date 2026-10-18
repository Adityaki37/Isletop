import {
  authenticatedAccount,
  AuthError,
  storageOperation,
  type AccountRow,
} from "./account-store";
import { usernameKey } from "./account-crypto";
import { api, storageClient, storageMutation } from "./convex-client";
import type { SocialLookup, SocialOverview } from "./social-types";
export const PRESENCE_TTL = 75000;
export async function socialAccount(req: Request) {
  const s = await authenticatedAccount(req);
  if (!s)
    throw new AuthError("Sign in to add friends and receive invitations.", 401);
  return s.row;
}
export async function socialLookup(
  owner: AccountRow,
  username: unknown,
): Promise<SocialLookup> {
  let key: string;
  try {
    key = usernameKey(username);
  } catch (e) {
    throw new AuthError(
      e instanceof Error ? e.message : "Choose a valid username.",
    );
  }
  return storageOperation(() =>
    storageClient().query(api.social.lookup, {
      owner: owner.id,
      username: key,
    }),
  );
}
export async function socialOverview(
  owner: AccountRow,
  code?: string | null,
): Promise<SocialOverview> {
  return storageOperation(() =>
    storageClient().query(api.social.overview, {
      owner: owner.id,
      code: code ?? null,
    }),
  );
}
export async function socialAction(
  owner: AccountRow,
  body: Record<string, unknown>,
) {
  return storageOperation(() =>
    storageMutation(api.social.action, { owner: owner.id, body }),
  );
}
