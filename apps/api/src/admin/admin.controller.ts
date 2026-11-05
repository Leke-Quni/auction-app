import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AdminGuard, JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";

// Everything under /admin needs a signed-in account that is an ADMIN in the database right now (see AdminGuard); the admin app
// never decides that for itself.
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  // Who the admin app is talking to. It also tells the admin app whether a signed-in person may use it at all.
  @Get("me")
  me(@Req() req: { user: AuthUser }) {
    return { id: req.user.id, email: req.user.email, role: req.user.role };
  }
}
