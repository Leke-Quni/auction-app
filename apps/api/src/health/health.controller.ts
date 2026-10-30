import { Controller, Get } from "@nestjs/common";

// For the host's health check. It does not touch the database, so a database blip never restarts the API.
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}
