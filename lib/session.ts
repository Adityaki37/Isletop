import {
  authenticatedAccount,
  guestIdentity,
  accountAliases,
} from "./account-store";
export async function identity(req: Request) {
  const account = await authenticatedAccount(req);
  if (account)
    return {
      id: account.row.player_id,
      aliases: await accountAliases(account.row),
      cookie: null,
      account: account.row,
    };
  return {
    ...(await guestIdentity(req)),
    aliases: [] as string[],
    account: null,
  };
}
