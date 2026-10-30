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

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(header.slice(7), authSecret(), {
        algorithms: ["HS256"],
        requiredClaims: ["exp", "sub"],
      });
      const claims = claimsSchema.parse(payload);
      req.user = { id: claims.sub, email: claims.email, role: claims.role } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
