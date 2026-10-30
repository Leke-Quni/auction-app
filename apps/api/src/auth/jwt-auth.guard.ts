import { USER_ROLES } from "@auction/shared";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { jwtVerify } from "jose";
import { z } from "zod";
import { authSecret } from "../config";

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  role: z.enum(USER_ROLES),
});

export interface AuthUser {
  id: string;
  email: string;
  role: (typeof USER_ROLES)[number];
}

/** Returns the user for a valid `Bearer` token, or null for a missing, malformed, expired, or incomplete one. */
async function authenticate(header: string | undefined): Promise<AuthUser | null> {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), authSecret(), {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "sub"],
    });
    const claims = claimsSchema.parse(payload);
    return { id: claims.sub, email: claims.email, role: claims.role } satisfies AuthUser;
  } catch {
    return null;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const user = await authenticate(req.headers.authorization);
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }
}

/** For public routes that show more to a signed-in owner: sets `req.user` when the token is valid, never rejects. */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.user = (await authenticate(req.headers.authorization)) ?? undefined;
    return true;
  }
}
