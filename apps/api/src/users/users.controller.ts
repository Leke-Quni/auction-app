import { Controller, Get, Inject, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";

@Controller("me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  @Get()
  async me(@Req() req: { user: AuthUser }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, emailVerified: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
