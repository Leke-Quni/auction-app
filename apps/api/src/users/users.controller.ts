import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";

@Controller("me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  @Get()
  me(@Req() req: { user: AuthUser }) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, emailVerified: true },
    });
  }
}
