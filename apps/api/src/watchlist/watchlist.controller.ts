import { Controller, Delete, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { WatchlistService } from "./watchlist.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get("watchlist")
  list(@Req() req: { user: AuthUser }) {
    return this.watchlist.list(req.user.id);
  }

  @Put("listings/:id/watch")
  watch(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.watchlist.watch(req.user.id, id);
  }

  @Delete("listings/:id/watch")
  unwatch(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.watchlist.unwatch(req.user.id, id);
  }
}
