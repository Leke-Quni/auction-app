import { Global, Module } from "@nestjs/common";
import "../config";
import { createMailSender } from "./create-mail-sender";
import { MAIL_SENDER } from "./mail-sender";

@Global()
@Module({
  providers: [{ provide: MAIL_SENDER, useFactory: () => createMailSender() }],
  exports: [MAIL_SENDER],
})
export class EmailModule {}
