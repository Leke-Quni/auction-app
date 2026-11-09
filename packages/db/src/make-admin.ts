// Makes an existing account an admin (or, with --super, a super admin; or, with --remove, an ordinary user again): the admin app has no sign-up, so the first admin
// is made here. Run it with `yarn workspace @auction/db make-admin <email> [--super | --remove]`; it works on whatever DATABASE_URL points
// at, so check that first. The API reads the role from the database on every request, so the change takes effect at once.
import { config } from "dotenv";
import { resolve } from "node:path";
import { createPrismaClient } from "./index";
import { parseMakeAdminArgs } from "./make-admin-args";

config({ path: resolve(__dirname, "../../../../.env") });

async function main() {
  const { email, role, superAdmin } = parseMakeAdminArgs(process.argv.slice(2));
  const prisma = createPrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, username: true, role: true, isSuperAdmin: true } });
    if (!user) throw new Error(`No account has the email ${email}. Sign up on the storefront first.`);
    const what = superAdmin ? "a super admin" : role === "ADMIN" ? "an admin" : "an ordinary user";
    if (user.role === role && (role === "USER" ? !user.isSuperAdmin : superAdmin ? user.isSuperAdmin : true)) {
      console.log(`${email} (${user.username}) is already ${what}.`);
      return;
    }
    // Plain `make-admin` on a super admin leaves them a super admin; only --remove takes the flag away.
    await prisma.user.update({ where: { id: user.id }, data: { role, isSuperAdmin: role === "USER" ? false : superAdmin || user.isSuperAdmin } });
    console.log(`${email} (${user.username}) is now ${what}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
