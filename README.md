# Isletop

An open-source multiplayer island strategy game. Trade resources, build settlements and cities, explore islands, and play with friends or bots. Play on www.isletop.com or run it yourselves.

Isletop includes guest play, username/password accounts with recovery codes, private hands, live rooms, spectators, replays, statistics, casual and ranked matchmaking, and several maps and expansion modes. It is an independent implementation with original generated SVG artwork and synthesized sound effects.

## Requirements

- Node.js 22.13 or newer and npm
- Your own Convex development deployment (local or cloud)

The frontend and API run on Next.js. Convex provides transactional storage, subscriptions, and scheduled game clocks. No social sign-in provider or analytics account is required.

## Run locally

```sh
npm ci
```

1. Run `npx convex dev` and choose your own project. The CLI creates `.env.local` with `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`. For a local backend, select it with `npx convex deployment select local`. The first attempt may report missing storage verification variables; configure them below, then restart the command.
2. Generate a fresh signing key for this installation:

   ```sh
   npm run setup:storage
   ```

3. Configure Convex with the generated **public** verification variables:

   ```sh
   npx convex env set --from-file .sites-runtime/storage-public-auth.env
   ```

4. Keep `npx convex dev` running to publish functions and run the backend. In a separate terminal:

   ```sh
   npm run dev
   ```

Open http://localhost:5174. Create a room and share its link with other browsers, add bots, or select Solo Practice. Guest seats persist in the same browser. The Account page supports local registration, sign-in, password changes, and one-time recovery codes; store the recovery code when it is shown.

`.env.example` documents the configuration names. All keys must be generated for your own installation. `.env.local`, local databases, generated verification files, and build output are ignored by Git.

## Build and validate

```sh
npm run typecheck
npm test
npm run check:assets
npm run build
npm start
```

Integration checks require a configured running backend and server. Set `TEST_ORIGIN=http://localhost:5174` before running:

```sh
node scripts/test-api.mjs accounts
npm run test:api
```

The tests in `tests/` cover game rules, maps, bots, accounts, authorization, trading, replays, timers, and complete simulated matches. Tests named `convex-*` may require a local Convex backend on port 3210. Run integration and load tests only against disposable development data.

## Deploy your own instance

Deploy the Next.js app to a Node.js host and the Convex functions to your own Convex deployment. Use `npm run build` and `npm start` for the web app. The `dev:vercel`, `build:vercel`, and `start:vercel` scripts are equivalent aliases.

Generate a separate storage signing key for production, passing an ignored environment file and your own issuer URL:

```sh
node scripts/setup-storage-auth.mjs .env.production.local https://your-game.example
```

The file must first contain your own `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`. Configure `STORAGE_JWT_ISSUER` and `STORAGE_JWT_JWKS` on that Convex deployment. Configure `NEXT_PUBLIC_CONVEX_URL`, `STORAGE_JWT_ISSUER`, and `STORAGE_JWT_PRIVATE_JWK` on the web host. The private JWK belongs only on the web server; it must never use a `NEXT_PUBLIC_` name or be committed. Convex deployment credentials belong only in your private deployment environment.

For a public installation, review the included privacy notice and adapt it to your host, retention policy, and support contact. See [SECURITY.md](SECURITY.md) for the trust boundaries.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Artwork and sound generators are in `scripts/generate-original-assets.mjs`; provenance is recorded in [public/art/PROVENANCE.md](public/art/PROVENANCE.md).

## License

Original project code, artwork, and sound generators are available under the [MIT License](LICENSE). Dependencies and vendored files retain their own licenses; see [third-party notices](public/third-party-notices.txt) and `vendor/`. Third-party game names and trademarks belong to their respective owners; no affiliation or endorsement is implied.
