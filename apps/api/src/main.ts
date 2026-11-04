import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { redisUrl, trustedProxies, webUrl } from "./config";
import { RealtimeAdapter } from "./realtime/realtime.adapter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set("trust proxy", trustedProxies());
  const realtime = new RealtimeAdapter(app);
  const redis = redisUrl();
  if (redis) await realtime.connectRedis(redis);
  app.useWebSocketAdapter(realtime);
  app.enableCors({ origin: webUrl() });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
