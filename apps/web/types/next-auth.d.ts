import type { UserRole } from "@auction/shared";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: UserRole;
    sessionVersion: number;
  }

  interface Session {
    user: { id: string; role: UserRole; sessionVersion: number } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    sv?: number;
  }
}
