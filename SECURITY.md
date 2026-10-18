# Security

Report vulnerabilities privately through GitHub's private vulnerability reporting feature when enabled, or ask the maintainer for a private reporting channel. Do not include credentials, player data, or session tokens in public issues.

The Next.js server authenticates accounts and guests and signs short-lived storage tokens. Convex checks token roles, account sessions, room ownership, and player permissions. The server signing key grants privileged storage access: keep it server-side and generate a different key for each installation and environment.

Only NEXT_PUBLIC_CONVEX_URL is browser configuration. STORAGE_JWT_PRIVATE_JWK must remain secret. STORAGE_JWT_ISSUER and STORAGE_JWT_JWKS describe public token verification. Use HTTPS for hosted accounts so session cookies receive the Secure attribute.

Local account passwords use salted scrypt hashes; recovery codes and session tokens are hashed before storage. Recovery codes are shown to the player once. Guest and account cookies are HttpOnly and SameSite=Lax. Account operations enforce origin checks and authentication rate limits.

Run tests and administrative cleanup tools only on disposable development deployments. Development room cleanup is disabled unless QA_CLEANUP_ALLOWED is explicitly configured as local-development-only. Never enable this on a production deployment.

The public repository contains a fresh source snapshot. It excludes the original private Git history, deployment credentials, environment files, database state, captured sessions, and service dashboard screenshots.
