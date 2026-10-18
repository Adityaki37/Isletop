import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";

// Generate a fresh key for your own deployment. Private material is written to
// its ignored server env file; neither keys nor tokens are logged.
const file = process.argv[2] ?? ".env.local";
let content = readFileSync(file, "utf8");
const configured = parseEnv(content);
if (!configured.CONVEX_DEPLOYMENT || !configured.NEXT_PUBLIC_CONVEX_URL)
  throw new Error("Select a Convex deployment first.");
if (configured.STORAGE_JWT_PRIVATE_JWK) {
  console.log("Storage signing key already configured; no rotation performed.");
} else {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const kid = process.argv[4] ?? "isletop-storage-v1";
  const privateJwk = {
    ...privateKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
  };
  const publicJwk = {
    ...publicKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
  };
  const issuer =
    process.argv[3] ?? "http://localhost:5174";
  new URL(issuer);
  const jwks =
    "data:text/plain;charset=utf-8;base64," +
    Buffer.from(JSON.stringify({ keys: [publicJwk] })).toString("base64");
  content = content.replace(/^STORAGE_JWT_(?:PRIVATE_JWK|ISSUER|JWKS)=.*\r?\n?/gm, "");
  content += `\nSTORAGE_JWT_PRIVATE_JWK=${JSON.stringify(privateJwk)}\nSTORAGE_JWT_ISSUER=${issuer}\nSTORAGE_JWT_JWKS=${jwks}\n`;
  writeFileSync(file, content, { mode: 0o600 });
  mkdirSync(".sites-runtime", { recursive: true });
  writeFileSync(
    file === ".env.local"
      ? ".sites-runtime/storage-public-auth.env"
      : ".sites-runtime/storage-production-public-auth.env",
    `STORAGE_JWT_ISSUER=${issuer}\nSTORAGE_JWT_JWKS=${jwks}\n`,
  );
  console.log(
    "Configured a server signing key locally and a public verification configuration.",
  );
}
