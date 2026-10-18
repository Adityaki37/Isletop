import type { QueryCtx, MutationCtx } from "./_generated/server";

export async function requireStorageServer(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (
    !identity ||
    identity.subject !== "storage-server" ||
    identity.role !== "server"
  )
    throw new Error("Unauthorized storage request.");
}
