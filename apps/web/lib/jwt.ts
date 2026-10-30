import type { JWT, JWTDecodeParams, JWTEncodeParams } from "next-auth/jwt";
import { jwtVerify, SignJWT } from "jose";

const keys = (secret: string | string[]) =>
  (Array.isArray(secret) ? secret : [secret]).map((s) => new TextEncoder().encode(s));

// Auth.js encrypts its JWTs by default. NestJS verifies them with the shared secret, so we sign plain HS256 JWTs.
export async function encodeJwt({ token = {}, secret, maxAge = 30 * 24 * 60 * 60 }: JWTEncodeParams) {
  const jwt = new SignJWT({ ...token })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge);
  if (token.sub) jwt.setSubject(token.sub);
  return jwt.sign(keys(secret)[0]);
}

export async function decodeJwt({ token, secret }: JWTDecodeParams): Promise<JWT | null> {
  if (!token) return null;
  for (const key of keys(secret)) {
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
      return payload as JWT;
    } catch {
      continue;
    }
  }
  return null;
}
