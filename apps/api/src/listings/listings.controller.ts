import {
  createListingSchema,
  listingImagesSchema,
  publishListingSchema,
  updateListingSchema,
  type CreateListingInput,
  type PublishListingInput,
  type UpdateListingInput,
  type ListingImageInput,
} from "@auction/shared";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard, OptionalJwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ListingsService } from "./listings.service";

type AuthedRequest = { user: AuthUser };

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

const imagesBodySchema = z.object({ images: listingImagesSchema });

@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get("categories")
  categories() {
    return this.listings.categories();
  }

  @Get("listings")
  list(@Query(new ZodValidationPipe(pageSchema)) query: z.infer<typeof pageSchema>) {
    return this.listings.list(query.page, query.pageSize);
  }

  @Get("me/listings")
  @UseGuards(JwtAuthGuard)
  mine(@Req() req: AuthedRequest) {
    return this.listings.mine(req.user.id);
  }

  @Get("listings/:id")
  @UseGuards(OptionalJwtAuthGuard)
  findOne(@Param("id") id: string, @Req() req: { user?: AuthUser }) {
    return this.listings.findOne(id, req.user?.id);
  }

  @Post("listings")
  @UseGuards(JwtAuthGuard)
  create(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(createListingSchema)) body: CreateListingInput) {
    return this.listings.create(req.user.id, body);
  }

  @Patch("listings/:id")
  @UseGuards(JwtAuthGuard)
  update(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateListingSchema)) body: UpdateListingInput,
  ) {
    return this.listings.update(req.user.id, id, body);
  }

  @Put("listings/:id/images")
  @UseGuards(JwtAuthGuard)
  setImages(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(imagesBodySchema)) body: { images: ListingImageInput[] },
  ) {
    return this.listings.setImages(req.user.id, id, body.images);
  }

  @Post("listings/:id/publish")
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  publish(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(publishListingSchema)) body: PublishListingInput,
  ) {
    return this.listings.publish(req.user.id, id, body);
  }

  @Delete("listings/:id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    await this.listings.remove(req.user.id, id);
  }
}
