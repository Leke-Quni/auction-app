import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { authSecret } from "../config";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export const generateCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

// `scope` ties a code to what it unlocks, so a code for one purpose can't be used for another.
export const hashCode = (scope: string, code: string) =>
  createHmac("sha256", authSecret()).update(`${scope}:${code}`).digest("hex");

export const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
