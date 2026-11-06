import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export * from "../generated/prisma/client";

const intFromEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

// The pool is explicit so it can be tuned for the host. `DB_POOL_MAX` is how many connections one process holds (10 is
// the pg default, kept). A request that cannot get a connection within `DB_CONNECT_TIMEOUT_MS` fails (the API answers 503)
// instead of waiting for ever behind a burst of bids that are queued on one auction's row lock.
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: intFromEnv("DB_POOL_MAX", 10),
      connectionTimeoutMillis: intFromEnv("DB_CONNECT_TIMEOUT_MS", 10_000),
    }),
  });
}
