# Open-source snapshot validation

The publication snapshot passed:

- Dependency installation and `npm ci --dry-run --ignore-scripts` lockfile validation.
- TypeScript checking and a production Next.js build.
- All 522 game and account unit tests.
- Original asset checks: 272 game images, 48 sounds, and 250 country badges.
- Local account API integration checks covering registration, cross-browser identity, guest imports, password and recovery rotation, session revocation, hashed storage, origin validation, and rate limits.
- Browser registration, profile rendering, sign-out, and sign-in with no page errors.
- A fresh local Convex backend smoke covering real private WebSocket projections, scheduled clocks without clients, duplicate and invalid moves, and replay privacy.
- A tracked-file scan for personal deployment identifiers, common credential formats, private JWK material, and original environment secrets. No matches remained. Only the blank `.env.example` template is tracked.
- A case-insensitive scan of every tracked file and path for superseded game branding. No matches remained in the sharing snapshot.

Clerk and analytics are absent from the installed dependency tree. Convex's lockfile metadata still lists its optional provider peer compatibility; those providers are not installed or configured.

ESLint is not yet clean: checking the changed application files reported 17 errors and 63 warnings, primarily existing effect/state patterns and image/navigation guidance. This release does not claim a clean lint run. CI currently checks types, tests, assets, and the production build.

Backend state, browser captures, test accounts, generated signing keys, and test logs stay in ignored local directories. They are not publication artifacts.
