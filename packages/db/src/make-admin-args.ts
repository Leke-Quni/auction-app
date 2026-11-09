export interface MakeAdminArgs {
  email: string;
  role: "ADMIN" | "USER";
  superAdmin: boolean;
}

// `make-admin <email>` promotes, `make-admin <email> --super` makes a super admin (the only one who can change other admins'
// roles), `make-admin <email> --remove` demotes (and drops the super flag). Anything else is refused with the usage line.
export function parseMakeAdminArgs(argv: string[]): MakeAdminArgs {
  const usage = "Usage: yarn workspace @auction/db make-admin <email> [--super | --remove]";
  const flags = argv.filter((a) => a.startsWith("--"));
  const rest = argv.filter((a) => !a.startsWith("--"));
  if (rest.length !== 1 || flags.some((f) => f !== "--remove" && f !== "--super") || (flags.includes("--remove") && flags.includes("--super"))) throw new Error(usage);
  const email = rest[0]!.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${rest[0]}" is not an email address. ${usage}`);
  const remove = flags.includes("--remove");
  return { email, role: remove ? "USER" : "ADMIN", superAdmin: flags.includes("--super") };
}
