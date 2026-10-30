import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { IMAGE_STORAGE, type ImageStorage } from "../src/listings/image-storage";

const sentCodes: string[] = [];
const fakeMail: MailSender = {
  async send(_to, _subject, text) {
    sentCodes.push(/code is (\d{6})/.exec(text)![1]);
  },
};
const deleted: string[] = [];
const fakeStorage: ImageStorage = {
  async delete(urls) {
    deleted.push(...urls);
  },
};

const stamp = Date.now();
const password = "hunter22!";
const emails = { seller: `lst-seller-${stamp}@example.com`, other: `lst-other-${stamp}@example.com` };
const DAY = 86_400_000;

const validListing = {
  title: "Vintage 1970s wristwatch",
  description: "Serviced, original strap, runs well.",
  categoryId: "category_watches_jewelry",
  condition: "GOOD",
  startingPriceCents: 1000,
  reservePriceCents: null,
  durationDays: 5,
};

describe("listings", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let sellerId: string;
  let otherId: string;
  let seller: string;
  let other: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const signUp = async (email: string, tag: string) => {
    await api()
      .post("/auth/signup")
      .send({ firstName: "Test", lastName: "User", username: `lst${tag}${stamp}`, email, password, confirmPassword: password })
      .expect(201);
    const res = await api().post("/auth/login/verify").send({ email, code: sentCodes.at(-1) }).expect(200);
    const token = await new SignJWT({ email, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(res.body.id)
      .setExpirationTime("10m")
      .sign(authSecret());
    return { id: res.body.id as string, token };
  };

  const image = (userId: string, n: number) => ({
    url: `https://abc123.public.blob.vercel-storage.com/listings/${userId}/photo-${n}.jpg`,
    pathname: `listings/${userId}/photo-${n}.jpg`,
  });

  const createDraft = async (over: object = {}) =>
    (await api().post("/listings").set(as(seller)).send({ ...validListing, ...over }).expect(201)).body;

  const createPublished = async (over: object = {}, publish: object = {}) => {
    const draft = await createDraft(over);
    await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 1)] }).expect(200);
    return (await api().post(`/listings/${draft.id}/publish`).set(as(seller)).send(publish).expect(200)).body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(fakeMail)
      .overrideProvider(IMAGE_STORAGE)
      .useValue(fakeStorage)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    ({ id: sellerId, token: seller } = await signUp(emails.seller, "s"));
    ({ id: otherId, token: other } = await signUp(emails.other, "o"));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
  });

  describe("categories", () => {
    it("are seeded, in order, and public", async () => {
      const res = await api().get("/categories").expect(200);
      expect(res.body).toHaveLength(10);
      expect(res.body[0]).toMatchObject({ slug: "collectibles" });
      expect(res.body.map((c: { slug: string }) => c.slug)).toContain("watches-jewelry");
      expect(res.body.at(-1)).toMatchObject({ slug: "other" });
    });
  });

  describe("creating a draft", () => {
    it("requires sign-in", async () => {
      await api().post("/listings").send(validListing).expect(401);
    });

    it("creates a draft owned by the seller, with no times or photos yet", async () => {
      const res = await api().post("/listings").set(as(seller)).send(validListing).expect(201);
      expect(res.body).toMatchObject({
        title: "Vintage 1970s wristwatch",
        status: "DRAFT",
        phase: "draft",
        startsAt: null,
        endsAt: null,
        seller: { id: sellerId },
        category: { slug: "watches-jewelry" },
        images: [],
      });
    });

    it("rejects invalid input with a field-level error", async () => {
      const res = await api().post("/listings").set(as(seller)).send({ ...validListing, title: "no" }).expect(400);
      expect(res.body.fieldErrors.title).toBeTruthy();
      await api().post("/listings").set(as(seller)).send({ ...validListing, startingPriceCents: 50 }).expect(400);
      await api().post("/listings").set(as(seller)).send({ ...validListing, durationDays: 4 }).expect(400);
      await api().post("/listings").set(as(seller)).send({ ...validListing, reservePriceCents: 500 }).expect(400);
    });

    it("rejects a category that does not exist", async () => {
      await api().post("/listings").set(as(seller)).send({ ...validListing, categoryId: "nope" }).expect(400);
    });
  });

  describe("who can see a draft", () => {
    it("is only the seller; everyone else gets a 404", async () => {
      const draft = await createDraft();
      await api().get(`/listings/${draft.id}`).set(as(seller)).expect(200);
      await api().get(`/listings/${draft.id}`).expect(404);
      await api().get(`/listings/${draft.id}`).set(as(other)).expect(404);
      await api().get(`/listings/${draft.id}`).set({ Authorization: "Bearer garbage" }).expect(404);
    });

    it("404s for an id that does not exist", async () => {
      await api().get("/listings/does-not-exist").expect(404);
    });

    it("never appears in the public list", async () => {
      const draft = await createDraft({ title: "Secret draft listing" });
      const res = await api().get("/listings?pageSize=50").expect(200);
      expect(res.body.items.map((l: { id: string }) => l.id)).not.toContain(draft.id);
    });
  });

  describe("editing a draft", () => {
    it("changes any field and checks the combined result", async () => {
      const draft = await createDraft();
      const res = await api()
        .patch(`/listings/${draft.id}`)
        .set(as(seller))
        .send({ title: "Renamed watch listing", startingPriceCents: 2500, reservePriceCents: 4000 })
        .expect(200);
      expect(res.body).toMatchObject({ title: "Renamed watch listing", startingPriceCents: 2500, reservePriceCents: 4000 });

      // Raising the start above the stored reserve is caught even though the reserve was not resent.
      await api().patch(`/listings/${draft.id}`).set(as(seller)).send({ startingPriceCents: 5000 }).expect(400);
      // Null clears the reserve.
      const cleared = await api().patch(`/listings/${draft.id}`).set(as(seller)).send({ reservePriceCents: null }).expect(200);
      expect(cleared.body.reservePriceCents).toBeNull();
    });

    it("cannot be edited by someone else", async () => {
      const draft = await createDraft();
      await api().patch(`/listings/${draft.id}`).set(as(other)).send({ title: "Hijacked listing" }).expect(404);
      await api().patch(`/listings/${draft.id}`).send({ title: "Anonymous edit" }).expect(401);
    });
  });

  describe("photos", () => {
    it("are saved in order, replaced as a set, and removed ones are deleted from storage", async () => {
      const draft = await createDraft();
      const put = (images: object[]) => api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images });

      const first = await put([image(sellerId, 1), image(sellerId, 2), image(sellerId, 3)]).expect(200);
      expect(first.body.images.map((i: { position: number; url: string }) => [i.position, i.url.split("/").pop()])).toEqual([
        [0, "photo-1.jpg"],
        [1, "photo-2.jpg"],
        [2, "photo-3.jpg"],
      ]);

      deleted.length = 0;
      const reordered = await put([image(sellerId, 3), image(sellerId, 1)]).expect(200);
      expect(reordered.body.images.map((i: { url: string }) => i.url.split("/").pop())).toEqual(["photo-3.jpg", "photo-1.jpg"]);
      expect(deleted).toEqual([image(sellerId, 2).url]);
    });

    it("must be on our Blob host, in the seller's own folder, and match their URL", async () => {
      const draft = await createDraft();
      const put = (images: object[]) => api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images });
      const good = image(sellerId, 1);

      await put([image(otherId, 1)]).expect(400); // someone else's folder
      await put([{ url: "https://evil.example.com/listings/x/a.jpg", pathname: `listings/${sellerId}/a.jpg` }]).expect(400);
      await put([{ ...good, url: good.url.replace("https:", "http:") }]).expect(400);
      await put([{ url: good.url, pathname: `listings/${sellerId}/other.jpg` }]).expect(400); // pathname/URL mismatch
      await put([{ url: good.url, pathname: `listings/${sellerId}/../${otherId}/x.jpg` }]).expect(400);
      await put([good, good]).expect(400); // duplicate
      await put(Array.from({ length: 9 }, (_, i) => image(sellerId, i))).expect(400); // too many
      await put(Array.from({ length: 8 }, (_, i) => image(sellerId, i))).expect(200);
    });

    it("cannot be changed by someone else", async () => {
      const draft = await createDraft();
      await api().put(`/listings/${draft.id}/images`).set(as(other)).send({ images: [image(otherId, 1)] }).expect(404);
    });
  });

  describe("publishing", () => {
    it("needs at least one photo", async () => {
      const draft = await createDraft();
      await api().post(`/listings/${draft.id}/publish`).set(as(seller)).send({}).expect(400);
    });

    it("starts now by default and ends after the chosen duration", async () => {
      const before = Date.now();
      const listing = await createPublished({ durationDays: 3 });
      expect(listing).toMatchObject({ status: "PUBLISHED", phase: "live" });
      const starts = new Date(listing.startsAt).getTime();
      expect(starts).toBeGreaterThanOrEqual(before - 1000);
      expect(starts).toBeLessThanOrEqual(Date.now() + 1000);
      expect(new Date(listing.endsAt).getTime() - starts).toBe(3 * DAY);
      expect(listing.publishedAt).toBeTruthy();
    });

    it("can be scheduled for later, which makes it upcoming", async () => {
      const startsAt = new Date(Date.now() + 2 * DAY).toISOString();
      const listing = await createPublished({ durationDays: 1 }, { startsAt });
      expect(listing.phase).toBe("upcoming");
      expect(new Date(listing.startsAt).toISOString()).toBe(startsAt);
      expect(new Date(listing.endsAt).getTime() - new Date(listing.startsAt).getTime()).toBe(DAY);
    });

    it("rejects a start time in the past or too far ahead", async () => {
      const draft = await createDraft();
      await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 1)] }).expect(200);
      const publish = (startsAt: string) => api().post(`/listings/${draft.id}/publish`).set(as(seller)).send({ startsAt });
      await publish(new Date(Date.now() - DAY).toISOString()).expect(400);
      await publish(new Date(Date.now() + 40 * DAY).toISOString()).expect(400);
      await publish("tomorrow").expect(400);
    });

    it("works only once, and only for the seller", async () => {
      const listing = await createPublished();
      await api().post(`/listings/${listing.id}/publish`).set(as(seller)).send({}).expect(409);
      const draft = await createDraft();
      await api().post(`/listings/${draft.id}/publish`).set(as(other)).send({}).expect(404);
    });
  });

  describe("after publishing", () => {
    it("is visible to everyone, signed in or not", async () => {
      const listing = await createPublished();
      const anon = await api().get(`/listings/${listing.id}`).expect(200);
      expect(anon.body).toMatchObject({ id: listing.id, seller: { id: sellerId }, images: [{ position: 0 }] });
      await api().get(`/listings/${listing.id}`).set(as(other)).expect(200);
    });

    it("locks everything except the description", async () => {
      const listing = await createPublished();
      const patch = (body: object) => api().patch(`/listings/${listing.id}`).set(as(seller)).send(body);

      for (const body of [
        { title: "A different title" },
        { startingPriceCents: 5000 },
        { reservePriceCents: 99999 },
        { durationDays: 7 },
        { categoryId: "category_art" },
        { condition: "NEW" },
        { description: "A fresh description text", title: "Sneaky title change" },
      ]) {
        await patch(body).expect(400);
      }
      const ok = await patch({ description: "An updated and longer description." }).expect(200);
      expect(ok.body.description).toBe("An updated and longer description.");
      expect(ok.body.title).toBe(listing.title);
    });

    it("keeps at least one photo but lets the seller swap them", async () => {
      const listing = await createPublished();
      const put = (images: object[]) => api().put(`/listings/${listing.id}/images`).set(as(seller)).send({ images });
      await put([]).expect(400);
      deleted.length = 0;
      const res = await put([image(sellerId, 2)]).expect(200);
      expect(res.body.images).toHaveLength(1);
      expect(deleted).toEqual([image(sellerId, 1).url]);
    });

    it("cannot be deleted, and others cannot change it (403, since it is public)", async () => {
      const listing = await createPublished();
      await api().delete(`/listings/${listing.id}`).set(as(seller)).expect(409);
      await api().patch(`/listings/${listing.id}`).set(as(other)).send({ description: "Taking over this one" }).expect(403);
      await api().put(`/listings/${listing.id}/images`).set(as(other)).send({ images: [image(otherId, 1)] }).expect(403);
    });
  });

  describe("deleting a draft", () => {
    it("removes it and its photos", async () => {
      const draft = await createDraft();
      await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 4)] }).expect(200);
      deleted.length = 0;
      await api().delete(`/listings/${draft.id}`).set(as(other)).expect(404);
      await api().delete(`/listings/${draft.id}`).set(as(seller)).expect(204);
      expect(deleted).toEqual([image(sellerId, 4).url]);
      await api().get(`/listings/${draft.id}`).set(as(seller)).expect(404);
      expect(await prisma.listingImage.count({ where: { listingId: draft.id } })).toBe(0);
    });
  });

  describe("lists", () => {
    it("shows only live and upcoming published listings, newest first, in pages", async () => {
      await prisma.listing.deleteMany({ where: { sellerId } });
      const a = await createPublished({ title: "Listing number one" });
      const b = await createPublished({ title: "Listing number two" });
      const c = await createPublished({ title: "Listing number three" });
      const ended = await createPublished({ title: "Listing already ended" });
      await prisma.listing.update({ where: { id: ended.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      await createDraft({ title: "Draft stays private" });

      const all = await api().get("/listings?pageSize=50").expect(200);
      const mine = all.body.items.filter((l: { seller: { id: string } }) => l.seller.id === sellerId);
      expect(mine.map((l: { id: string }) => l.id)).toEqual([c.id, b.id, a.id]);

      const page1 = await api().get("/listings?pageSize=2").expect(200);
      expect(page1.body).toMatchObject({ page: 1, pageSize: 2 });
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(all.body.total);
      const page2 = await api().get("/listings?pageSize=2&page=2").expect(200);
      expect(page2.body.items.map((l: { id: string }) => l.id)).not.toContain(page1.body.items[0].id);
    });

    it("rejects nonsense paging values", async () => {
      await api().get("/listings?page=0").expect(400);
      await api().get("/listings?pageSize=500").expect(400);
      await api().get("/listings?page=abc").expect(400);
    });

    it("gives a seller all of their own listings, drafts included, and nobody else's", async () => {
      const mine = await api().get("/me/listings").set(as(seller)).expect(200);
      expect(mine.body.length).toBeGreaterThan(0);
      expect(mine.body.every((l: { seller: { id: string } }) => l.seller.id === sellerId)).toBe(true);
      expect(mine.body.some((l: { status: string }) => l.status === "DRAFT")).toBe(true);

      const theirs = await api().get("/me/listings").set(as(other)).expect(200);
      expect(theirs.body).toEqual([]);
      await api().get("/me/listings").expect(401);
    });
  });
});
