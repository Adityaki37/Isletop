import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <h1>Privacy</h1>
      <p>This is the default notice for a self-hosted Isletop installation. The operator should provide its own contact information, retention policy, and hosting details before opening a public service.</p>
      <h2>Accounts and guest play</h2>
      <p>You can play as a guest or create a username/password account. Passwords use salted hashes. Session tokens and recovery codes are stored as hashes. Cookies preserve your identity and seats; browser storage remembers preferences and player names.</p>
      <h2>Game data and visibility</h2>
      <p>The game stores profiles, room activity, messages, results, replays, and statistics. Your chosen username, display name, avatar, bio, region, and public statistics can be visible to other players. Hands and participant replay access follow the game&apos;s authorization rules.</p>
      <h2>Hosting and account controls</h2>
      <p>Game data is stored in the operator&apos;s Convex deployment. Hosting providers may process technical request information. This distribution includes no social login or analytics integration. Use Account to update your profile, change your password, replace your recovery code, or revoke sessions. Signing out does not delete saved games; contact the operator about deletion and retention.</p>
      <Link href="/">Back to Isletop</Link>
    </main>
  );
}
