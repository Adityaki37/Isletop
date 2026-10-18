import type { AuthConfig } from "convex/server";

// The public signing key is a data URI; verification requires no frontend call.
// The corresponding private key stays in the Vercel server environment.
export default {
  providers: [
    {
      type: "customJwt",
      issuer: process.env.STORAGE_JWT_ISSUER!,
      applicationID: "island-table",
      jwks: process.env.STORAGE_JWT_JWKS!,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
