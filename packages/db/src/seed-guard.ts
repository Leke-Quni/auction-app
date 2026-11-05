const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface SeedGuardOptions {
  // Set by `--allow-remote`: the person knows this is not their local database and means it.
  allowRemote?: boolean;
  // Set by `--confirm-host <host>`: must be exactly the database's host, so a connection string pasted by mistake is not seeded.
  confirmHost?: string;
}

// The seed script writes sample data and deletes its earlier sample data, so it runs against a local database unless the
// person says otherwise twice: `--allow-remote` and `--confirm-host <the database's host>`. It never runs when NODE_ENV is
// production. The messages name the host but never print the connection string, which holds the password.
export function assertSafeToSeed(env: { NODE_ENV?: string; DATABASE_URL?: string }, options: SeedGuardOptions = {}) {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed: NODE_ENV is production.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  let host: string;
  try {
    host = new URL(env.DATABASE_URL).hostname;
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a valid URL.");
  }
  if (LOCAL_HOSTS.has(host)) return;
  if (!options.allowRemote) {
    throw new Error(`Refusing to seed: the database host "${host}" is not local (localhost or 127.0.0.1). To seed it anyway, add --allow-remote --confirm-host ${host}`);
  }
  if (options.confirmHost !== host) {
    throw new Error(`Refusing to seed: --confirm-host must be exactly the database host "${host}".`);
  }
}
