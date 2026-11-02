import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { ListingsService } from "../listings/listings.service";

async function reindex() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const count = await app.get(ListingsService).reindexSearch();
  console.log(`Indexed ${count} live and upcoming listings.`);
  await app.close();
}
void reindex();
