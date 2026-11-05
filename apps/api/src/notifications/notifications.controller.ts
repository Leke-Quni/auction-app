import { Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { SavedNotificationsService } from "./saved-notifications.service";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly saved: SavedNotificationsService) {}

  @Get()
  list(@Req() req: { user: AuthUser }) {
    return this.saved.list(req.user.id);
  }

  @Delete()
  clear(@Req() req: { user: AuthUser }) {
    return this.saved.clear(req.user.id);
  }

  @Delete(":id")
  dismiss(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.saved.dismiss(req.user.id, id);
  }

  @Post(":id/read")
  read(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.saved.markRead(req.user.id, id);
  }
}
