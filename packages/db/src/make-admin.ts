// Makes an existing account an admin (or, with --remove, an ordinary user again): the admin app has no sign-up, so the first admin
// is made here. Run it with `yarn workspace @auction/db make-admin <email> [--remove]`; it works on whatever DATABASE_URL points
// at, so check that first. The API reads the role from the database on every request, so the change takes effect at once.
import { config } from "dotenv";
import { resolve } from "node:path";
import { createPrismaClient } from "./index";
import { parseMakeAdminArgs } from "./make-admin-args";

config({ path: resolve(__dirname, "../../../../.env") });

async function main() {
  const { email, role } = parseMakeAdminArgs(process.argv.slice(2));
  const prisma = createPrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, username: true, role: true } });
    if (!user) throw new Error(`No account has the email ${email}. Sign up on the storefront first.`);
    if (user.role === role) {
      console.log(`${email} (${user.username}) is already ${role === "ADMIN" ? "an admin" : "an ordinary user"}.`);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { role } });
    console.log(`${email} (${user.username}) is now ${role === "ADMIN" ? "an admin" : "an ordinary user"}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
