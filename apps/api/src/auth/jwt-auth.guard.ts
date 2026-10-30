import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { jwtVerify } from "jose";
import { authSecret } from "../config";

export interface AuthUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(header.slice(7), authSecret(), { algorithms: ["HS256"] });
      req.user = { id: payload.sub, email: payload.email, role: payload.role } as AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
