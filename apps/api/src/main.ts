import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { webUrl } from "./config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: webUrl() });
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
