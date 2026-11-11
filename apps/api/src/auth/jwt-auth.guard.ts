import { USER_ROLES } from "@auction/shared";
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { jwtVerify } from "jose";
import { z } from "zod";
import { authSecret } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";

// Only who is asking. The email and role are read from the database, so a token without them is still a valid token.
// `sv` is the account's session version when the person signed in; a token from before the claim existed counts as 0.
const claimsSchema = z.object({ sub: z.string().min(1), sv: z.number().int().optional() });

export interface AuthUser {
  id: string;
  email: string;
  role: (typeof USER_ROLES)[number];
  isSuperAdmin: boolean;
}

/** Returns the user id for a valid token, or null for a malformed, expired, or incomplete one. The token's role is not trusted. */
export async function verifyToken(token: string): Promise<{ id: string; sessionVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, authSecret(), {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "sub"],
    });
    const claims = claimsSchema.parse(payload);
    return { id: claims.sub, sessionVersion: claims.sv ?? 0 };
  } catch {
    return null;
  }
}

export type TokenUser = { status: "ok"; user: AuthUser } | { status: "banned" } | { status: "invalid" };

/**
 * A token is only proof of who is asking (and that the password has not changed since). What that person may do is read from the database on every request, so a demoted
 * admin, a promoted user or a banned account changes at once instead of when their 30-day token runs out.
 */
export async function loadTokenUser(prisma: Prisma, token: string): Promise<TokenUser> {
  const verified = await verifyToken(token);
  if (!verified) return { status: "invalid" };
  const user = await prisma.user.findUnique({ where: { id: verified.id }, select: { id: true, email: true, role: true, isSuperAdmin: true, bannedAt: true, sessionVersion: true } });
  // A password change or reset ends every session made before it.
  if (!user || user.sessionVersion !== verified.sessionVersion) return { status: "invalid" };
  if (user.bannedAt) return { status: "banned" };
  return { status: "ok", user: { id: user.id, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin } };
}

const bearer = (header: string | undefined) => (header?.startsWith("Bearer ") ? header.slice(7) : null);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const token = bearer(req.headers.authorization);
    const result = token ? await loadTokenUser(this.prisma, token) : ({ status: "invalid" } as const);
    if (result.status === "invalid") throw new UnauthorizedException();
    if (result.status === "banned") throw new ForbiddenException({ code: "BANNED", message: "This account has been suspended." });
    req.user = result.user;
    return true;
  }
}

/** For public routes that show more to a signed-in owner: sets `req.user` when the token is valid, never rejects. A banned account is treated as signed out. */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const token = bearer(req.headers.authorization);
    const result = token ? await loadTokenUser(this.prisma, token) : null;
    req.user = result?.status === "ok" ? result.user : undefined;
    return true;
  }
}

/** Use after `JwtAuthGuard`: only an account whose role is ADMIN in the database gets through. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (user?.role !== "ADMIN") throw new ForbiddenException({ code: "NOT_ADMIN", message: "Admins only." });
    return true;
  }
}
