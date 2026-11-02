const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The seed script writes sample data and deletes its earlier sample data, so it must only ever run against a local
// database. The messages name the host but never print the connection string, which holds the password.
export function assertSafeToSeed(env: { NODE_ENV?: string; DATABASE_URL?: string }) {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed: NODE_ENV is production.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  let host: string;
  try {
    host = new URL(env.DATABASE_URL).hostname;
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed: the database host "${host}" is not local (localhost or 127.0.0.1).`);
  }
}
