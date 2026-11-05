import type { SeedGuardOptions } from "./seed-guard";

export interface SeedArgs extends SeedGuardOptions {
  // How many sample listings to make (0 only removes the sample data).
  count: number;
  // How many sample accounts: each is a seller and a bidder.
  users: number;
  // The email of a real account that already exists, which is given a bit of every situation (wins, sales, bids, a watchlist,
  // notifications), so it can be tried from a real sign-in.
  owner?: string;
}

export const MAX_COUNT = 20_000;
export const MAX_USERS = 2_000;
export const DEFAULT_COUNT = 1000;
export const DEFAULT_USERS = 40;

// `seed [count] [--users N] [--owner email] [--allow-remote --confirm-host host]`
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const args: SeedArgs = { count: DEFAULT_COUNT, users: DEFAULT_USERS };
  let sawCount = false;
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--allow-remote") args.allowRemote = true;
    else if (arg === "--confirm-host") args.confirmHost = value(i++, arg);
    else if (arg === "--owner") args.owner = value(i++, arg).toLowerCase();
    else if (arg === "--users") args.users = Number.parseInt(value(i++, arg), 10);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else if (!sawCount) {
      sawCount = true;
      args.count = Number.parseInt(arg, 10);
    } else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!Number.isInteger(args.count) || args.count < 0 || args.count > MAX_COUNT) throw new Error(`Give a count between 0 and ${MAX_COUNT}`);
  if (!Number.isInteger(args.users) || args.users < 30 || args.users > MAX_USERS) throw new Error(`--users must be between 30 and ${MAX_USERS}`);
  if (args.owner !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.owner)) throw new Error("--owner must be an email address");
  if (args.owner?.endsWith("@seed.local")) throw new Error("--owner must be a real account, not a sample one");
  return args;
}
