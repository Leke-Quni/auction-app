export interface MakeAdminArgs {
  email: string;
  role: "ADMIN" | "USER";
}

// `make-admin <email>` promotes, `make-admin <email> --remove` demotes. Anything else is refused with the usage line.
export function parseMakeAdminArgs(argv: string[]): MakeAdminArgs {
  const usage = "Usage: yarn workspace @auction/db make-admin <email> [--remove]";
  const flags = argv.filter((a) => a.startsWith("--"));
  const rest = argv.filter((a) => !a.startsWith("--"));
  if (rest.length !== 1 || flags.some((f) => f !== "--remove")) throw new Error(usage);
  const email = rest[0]!.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${rest[0]}" is not an email address. ${usage}`);
  return { email, role: flags.includes("--remove") ? "USER" : "ADMIN" };
}
