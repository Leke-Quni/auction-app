import { Controller, Get, Param } from "@nestjs/common";
import { ProfilesService } from "./profiles.service";

@Controller("users")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get(":username")
  get(@Param("username") username: string) {
    return this.profiles.get(username);
  }
}
