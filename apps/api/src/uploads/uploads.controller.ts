import { UPLOAD_DAILY_RATE_LIMIT, UPLOAD_HOURLY_RATE_LIMIT } from "@auction/shared";
import { Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";

// The web app asks here before it hands a signed-in person permission to upload a photo (the upload itself goes from the browser
// straight to the photo store). The count lives here because the API has the shared limiter and the web app has none.
@Controller("uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  @Post("authorize")
  @HttpCode(204)
  async authorize(@Req() req: { user: AuthUser }) {
    const hourly = await this.limiter.allow(`rl:upload-hour:${req.user.id}`, UPLOAD_HOURLY_RATE_LIMIT.limit, UPLOAD_HOURLY_RATE_LIMIT.windowSeconds);
    const daily = await this.limiter.allow(`rl:upload-day:${req.user.id}`, UPLOAD_DAILY_RATE_LIMIT.limit, UPLOAD_DAILY_RATE_LIMIT.windowSeconds);
    if (!hourly || !daily) {
      throw new HttpException({ code: "RATE_LIMITED", message: "You have uploaded a lot of photos. Wait a while and try again." }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
