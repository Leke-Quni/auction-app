import {
  MAX_IMAGES,
  createListingSchema,
  listingImagesSchema,
  pickupAddressSchema,
  type PickupAddress,
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
  section: z.enum(["endingSoon", "upcoming"]).optional(),
});

const imagesBodySchema = z.object({ images: listingImagesSchema });
const unusedImagesSchema = z.object({ urls: z.array(z.string().url().max(2048)).max(MAX_IMAGES) });

@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get("categories")
  categories() {
    return this.listings.categories();
  }

  @Get("listings")
  list(@Query(new ZodValidationPipe(pageSchema)) query: z.infer<typeof pageSchema>) {
    return this.listings.list(query.page, query.pageSize, query.section);
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

  // Of the given photo URLs, the ones no listing uses (so they can be deleted from storage).
  @Post("listing-images/unused")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async unusedImages(@Body(new ZodValidationPipe(unusedImagesSchema)) body: z.infer<typeof unusedImagesSchema>) {
    return { urls: await this.listings.unusedImageUrls(body.urls) };
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

  // The seller may correct where the carrier collects at any time, even after publishing or a sale: a typo found late must be fixable.
  @Put("listings/:id/pickup-address")
  @UseGuards(JwtAuthGuard)
  setPickupAddress(@Req() req: AuthedRequest, @Param("id") id: string, @Body(new ZodValidationPipe(pickupAddressSchema)) body: PickupAddress) {
    return this.listings.setPickupAddress(req.user.id, id, body);
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

  @Post("listings/:id/relist")
  @UseGuards(JwtAuthGuard)
  relist(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.listings.relist(req.user.id, id);
  }

  @Delete("listings/:id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.listings.remove(req.user.id, id);
  }
}
