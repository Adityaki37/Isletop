# Contributor guide

Use Node.js 22.13 or newer. Follow the setup in README.md using your own development backend and freshly generated keys.

Before submitting a change, run `npm run typecheck`, `npm test`, `npm run check:assets`, and `npm run build`. For account, room, or storage changes, also run the relevant integration suite against disposable development data.

Keep hidden player state and permissions on the server. Never include credentials, browser sessions, real player records, environment files, hosting account identifiers, or screenshots of service dashboards in contributions. Keep dependency and asset licenses intact.

Describe the behavior changed and the checks you ran in your pull request. Use original assets or assets with compatible, documented licenses.
