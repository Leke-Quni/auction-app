import { Module } from "@nestjs/common";
import { BlobImageStorage, IMAGE_STORAGE } from "./image-storage";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";

@Module({
  controllers: [ListingsController],
  providers: [ListingsService, { provide: IMAGE_STORAGE, useClass: BlobImageStorage }],
})
export class ListingsModule {}
