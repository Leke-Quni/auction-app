import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { ListingsService } from "../src/listings/listings.service";
import { SEARCH_INDEX, type ListingDocument, type SearchIndex } from "../src/search/search-index";

const sentCodes: string[] = [];
const fakeMail: MailSender = {
  async send(_to, _subject, text) {
    sentCodes.push(/code is (\d{6})/.exec(text)![1]);
  },
};

const indexed = new Map<string, ListingDocument>();
let failSearch = false;
const fakeSearch: SearchIndex = {
  async ensureReady() {},
  async upsert(doc) {
    if (failSearch) throw new Error("search is down");
    indexed.set(doc.id, doc);
  },
  async update(id, fields) {
    const doc = indexed.get(id);
    if (doc) indexed.set(id, { ...doc, ...fields });
  },
  async remove(id) {
    if (failSearch) throw new Error("search is down");
    indexed.delete(id);
  },
  async removeEnded(now) {
    for (const [id, doc] of indexed) if (doc.ends_at <= now.getTime() / 1000) indexed.delete(id);
  },
  async replaceAll(docs) {
    indexed.clear();
    for (const doc of docs) indexed.set(doc.id, doc);
  },
  async search() {
    return { documents: [], total: 0 };
  },
};

const stamp = Date.now();
const password = "hunter22!";
const emails = { seller: `lst-seller-${stamp}@example.com`, other: `lst-other-${stamp}@example.com` };
const DAY = 86_400_000;

const validListing = {
  pickupAddress: { name: "Sam Seller", line1: "Rr. Dardania 12", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344000111" },
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
      .overrideProvider(SEARCH_INDEX)
      .useValue(fakeSearch)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    ({ id: sellerId, token: seller } = await signUp(emails.seller, "s"));
    ({ id: otherId, token: other } = await signUp(emails.other, "o"));
  });

  // The tests reuse the same photo URLs; real uploads are unique, and a photo another listing still uses is not reported as removed.
  beforeEach(async () => {
    await prisma.listing.deleteMany({ where: { sellerId } });
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

    it("accepts the Poor condition and the 30-day duration, and rejects the removed 'for parts' condition", async () => {
      const ok = await api().post("/listings").set(as(seller)).send({ ...validListing, condition: "POOR", durationDays: 30 }).expect(201);
      expect(ok.body).toMatchObject({ condition: "POOR", durationDays: 30 });
      await api().post("/listings").set(as(seller)).send({ ...validListing, condition: "FOR_PARTS" }).expect(400);
      await api().post("/listings").set(as(seller)).send({ ...validListing, condition: "OLD" }).expect(400);
      await api().post("/listings").set(as(seller)).send({ ...validListing, durationDays: 14 }).expect(400);
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
    it("are saved in order, replaced as a set, and the removed ones are reported so the web app can delete them", async () => {
      const draft = await createDraft();
      const put = (images: object[]) => api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images });

      const first = await put([image(sellerId, 1), image(sellerId, 2), image(sellerId, 3)]).expect(200);
      expect(first.body.images.map((i: { position: number; url: string }) => [i.position, i.url.split("/").pop()])).toEqual([
        [0, "photo-1.jpg"],
        [1, "photo-2.jpg"],
        [2, "photo-3.jpg"],
      ]);
      expect(first.body.removedImageUrls).toEqual([]);

      const reordered = await put([image(sellerId, 3), image(sellerId, 1)]).expect(200);
      expect(reordered.body.images.map((i: { url: string }) => i.url.split("/").pop())).toEqual(["photo-3.jpg", "photo-1.jpg"]);
      expect(reordered.body.removedImageUrls).toEqual([image(sellerId, 2).url]);

      // Reordering alone removes nothing.
      const swapped = await put([image(sellerId, 1), image(sellerId, 3)]).expect(200);
      expect(swapped.body.removedImageUrls).toEqual([]);
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

  describe("the pickup address", () => {
    it("is shown to the seller only, never to buyers or visitors", async () => {
      const listing = await createPublished();
      const owner = (await api().get(`/listings/${listing.id}`).set(as(seller)).expect(200)).body;
      expect(owner.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12", phone: "+38344000111" });
      const visitor = (await api().get(`/listings/${listing.id}`).expect(200)).body;
      expect(JSON.stringify(visitor)).not.toContain("Dardania");
      expect(visitor).not.toHaveProperty("pickupAddress");
      const viewedByOther = (await api().get(`/listings/${listing.id}`).set(as(other)).expect(200)).body;
      expect(JSON.stringify(viewedByOther)).not.toContain("Dardania");
      const page = (await api().get("/listings").expect(200)).body;
      expect(JSON.stringify(page)).not.toContain("Dardania");
    });

    it("cannot change once the listing is published", async () => {
      const listing = await createPublished();
      await api().patch(`/listings/${listing.id}`).set(as(seller)).send({ pickupAddress: { ...validListing.pickupAddress, line1: "Elsewhere 1" } }).expect(400);
    });
  });

  describe("publishing", () => {
    it("needs a pickup address", async () => {
      const draft = await createDraft({ pickupAddress: undefined });
      await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 1)] }).expect(200);
      const res = await api().post(`/listings/${draft.id}/publish`).set(as(seller)).send({}).expect(400);
      expect(res.body.message).toMatch(/pickup address/);
      await api().patch(`/listings/${draft.id}`).set(as(seller)).send({ pickupAddress: validListing.pickupAddress }).expect(200);
      await api().post(`/listings/${draft.id}/publish`).set(as(seller)).send({}).expect(200);
    });

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

    it("ends 30 days after it starts for a one-month auction", async () => {
      const listing = await createPublished({ durationDays: 30 });
      expect(new Date(listing.endsAt).getTime() - new Date(listing.startsAt).getTime()).toBe(30 * DAY);
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
      const res = await put([image(sellerId, 2)]).expect(200);
      expect(res.body.images).toHaveLength(1);
      expect(res.body.removedImageUrls).toEqual([image(sellerId, 1).url]);
    });

    it("can be removed by its seller, who gets the photos back to delete; others get 403 (since it is public)", async () => {
      const listing = await createPublished();
      await api().delete(`/listings/${listing.id}`).set(as(other)).expect(403);
      const removed = await api().delete(`/listings/${listing.id}`).set(as(seller)).expect(200);
      expect(removed.body.removedImageUrls).toEqual([image(sellerId, 1).url]);
      await api().get(`/listings/${listing.id}`).expect(404);
    });

    it("cannot be changed by others (403, since it is public)", async () => {
      const listing = await createPublished();
      await api().patch(`/listings/${listing.id}`).set(as(other)).send({ description: "Taking over this one" }).expect(403);
      await api().put(`/listings/${listing.id}/images`).set(as(other)).send({ images: [image(otherId, 1)] }).expect(403);
    });
  });

  describe("deleting a draft", () => {
    it("removes it and reports its photos so the web app can delete them", async () => {
      const draft = await createDraft();
      await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 4)] }).expect(200);
      await api().delete(`/listings/${draft.id}`).set(as(other)).expect(404);
      const res = await api().delete(`/listings/${draft.id}`).set(as(seller)).expect(200);
      expect(res.body).toEqual({ removedImageUrls: [image(sellerId, 4).url] });
      await api().get(`/listings/${draft.id}`).set(as(seller)).expect(404);
      expect(await prisma.listingImage.count({ where: { listingId: draft.id } })).toBe(0);
    });
  });

  describe("listing it again", () => {
    // An auction that ended: closed with the given outcome, as the close would leave it.
    const ended = async (outcome: "NO_SALE" | "NO_BIDS" | "SOLD") => {
      const listing = await createPublished({ title: "Relist me", reservePriceCents: 5000 });
      await prisma.listing.update({ where: { id: listing.id }, data: { startsAt: new Date(Date.now() - 6 * DAY), endsAt: new Date(Date.now() - 1000), closedAt: new Date(), outcome } });
      return listing;
    };

    it("copies an auction that had no bids into a new draft with the same details and photos", async () => {
      const old = await ended("NO_BIDS");
      const res = await api().post(`/listings/${old.id}/relist`).set(as(seller)).expect(201);
      expect(res.body).toMatchObject({ status: "DRAFT", title: "Relist me", reservePriceCents: 5000, startingPriceCents: 1000, durationDays: 5, condition: "GOOD", closedAt: null, outcome: null, bidCount: 0 });
      expect(res.body.id).not.toBe(old.id);
      expect(res.body.images).toHaveLength(1);
      const saved = await prisma.listing.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(saved.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12" });
      expect(saved.startsAt).toBeNull();
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: old.id } })).outcome).toBe("NO_BIDS"); // the old one stays as the record
    });

    it("works for an auction that ended without a sale, and the new draft can be published", async () => {
      const old = await ended("NO_SALE");
      const draft = (await api().post(`/listings/${old.id}/relist`).set(as(seller)).expect(201)).body;
      const published = (await api().post(`/listings/${draft.id}/publish`).set(as(seller)).send({}).expect(200)).body;
      expect(published.status).toBe("PUBLISHED");
    });

    it("returns the draft it already made when asked again, even at the same moment, and makes a new one once that is published", async () => {
      const old = await ended("NO_BIDS");
      const results = await Promise.all([1, 2, 3].map(() => api().post(`/listings/${old.id}/relist`).set(as(seller))));
      results.forEach((r) => expect(r.status).toBe(201));
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await prisma.listing.count({ where: { relistedFromId: old.id } })).toBe(1);
      const draftId = results[0]!.body.id;
      await api().post(`/listings/${draftId}/publish`).set(as(seller)).send({}).expect(200);
      const again = await api().post(`/listings/${old.id}/relist`).set(as(seller)).expect(201);
      expect(again.body.id).not.toBe(draftId);
    });

    it("refuses a sale, an auction still running, and a draft", async () => {
      const sold = await ended("SOLD");
      await api().post(`/listings/${sold.id}/relist`).set(as(seller)).expect(409);
      const running = await createPublished();
      await api().post(`/listings/${running.id}/relist`).set(as(seller)).expect(409);
      const draft = await createDraft();
      await api().post(`/listings/${draft.id}/relist`).set(as(seller)).expect(409);
    });

    it("is for the seller only", async () => {
      const old = await ended("NO_BIDS");
      await api().post(`/listings/${old.id}/relist`).expect(401);
      await api().post(`/listings/${old.id}/relist`).set(as(other)).expect(403);
    });

    it("keeps a photo in Blob while the other listing still uses it", async () => {
      const old = await ended("NO_BIDS");
      const draft = (await api().post(`/listings/${old.id}/relist`).set(as(seller)).expect(201)).body;
      const removed = await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 2)] }).expect(200);
      expect(removed.body.removedImageUrls).toEqual([]); // photo 1 is still on the old listing
      const gone = await api().delete(`/listings/${draft.id}`).set(as(seller)).expect(200);
      expect(gone.body.removedImageUrls).toEqual([image(sellerId, 2).url]);
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
      await createDraft();
      await createPublished();
      const mine = await api().get("/me/listings").set(as(seller)).expect(200);
      expect(mine.body.length).toBe(2);
      expect(mine.body.every((l: { seller: { id: string } }) => l.seller.id === sellerId)).toBe(true);
      expect(mine.body.some((l: { status: string }) => l.status === "DRAFT")).toBe(true);

      const theirs = await api().get("/me/listings").set(as(other)).expect(200);
      expect(theirs.body).toEqual([]);
      await api().get("/me/listings").expect(401);
    });

    it("can list just the upcoming auctions (soonest start first) or those ending within a day (soonest end first)", async () => {
      await prisma.listing.deleteMany({ where: { sellerId } });
      const soon = await createPublished({ title: "Ends in two hours" });
      await prisma.listing.update({ where: { id: soon.id }, data: { endsAt: new Date(Date.now() + 2 * 3600_000) } });
      const sooner = await createPublished({ title: "Ends in ten minutes" });
      await prisma.listing.update({ where: { id: sooner.id }, data: { endsAt: new Date(Date.now() + 600_000) } });
      const later = await createPublished({ title: "Ends in three days", durationDays: 3 });
      const upcomingLate = await createPublished({ title: "Starts in five days" }, { startsAt: new Date(Date.now() + 5 * DAY).toISOString() });
      const upcomingEarly = await createPublished({ title: "Starts in two days" }, { startsAt: new Date(Date.now() + 2 * DAY).toISOString() });
      const ended = await createPublished({ title: "Already ended" });
      await prisma.listing.update({ where: { id: ended.id }, data: { endsAt: new Date(Date.now() - 1000) } });

      // The database may hold other listings too (for example sample data), so walk every page and keep this seller's.
      const ids = async (section: string) => {
        const found: string[] = [];
        for (let page = 1; ; page++) {
          const { items, total } = (await api().get(`/listings?pageSize=50&page=${page}&section=${section}`).expect(200)).body;
          found.push(...items.filter((l: { seller: { id: string } }) => l.seller.id === sellerId).map((l: { id: string }) => l.id));
          if (page * 50 >= total) return found;
        }
      };
      expect(await ids("endingSoon")).toEqual([sooner.id, soon.id]);
      expect(await ids("upcoming")).toEqual([upcomingEarly.id, upcomingLate.id]);
      expect(later.id).toBeTruthy();
      await api().get("/listings?section=nonsense").expect(400);
    });
  });
  describe("search index", () => {
    beforeEach(() => {
      indexed.clear();
      failSearch = false;
    });

    it("never holds drafts, and holds a listing from the moment it is published", async () => {
      const draft = await createDraft();
      await api().put(`/listings/${draft.id}/images`).set(as(seller)).send({ images: [image(sellerId, 1)] }).expect(200);
      await api().patch(`/listings/${draft.id}`).set(as(seller)).send({ title: "A draft title" }).expect(200);
      expect(indexed.size).toBe(0);

      await api().post(`/listings/${draft.id}/publish`).set(as(seller)).send({}).expect(200);
      const doc = indexed.get(draft.id)!;
      expect(doc).toMatchObject({
        title: "A draft title",
        category_slug: "watches-jewelry",
        condition: "GOOD",
        price_cents: 1000,
        bid_count: 0,
        cover_url: image(sellerId, 1).url,
      });
      expect(doc.ends_at - doc.starts_at).toBe(5 * 86_400);
    });

    it("follows description and photo changes on a published listing", async () => {
      const listing = await createPublished();
      await api().patch(`/listings/${listing.id}`).set(as(seller)).send({ description: "Now with a new strap." }).expect(200);
      expect(indexed.get(listing.id)!.description).toBe("Now with a new strap.");
      await api().put(`/listings/${listing.id}/images`).set(as(seller)).send({ images: [image(sellerId, 2), image(sellerId, 1)] }).expect(200);
      expect(indexed.get(listing.id)!.cover_url).toBe(image(sellerId, 2).url);
    });

    it("leaves the index when the seller removes the listing, even if search is down for the removal", async () => {
      const listing = await createPublished();
      expect(indexed.has(listing.id)).toBe(true);
      await api().delete(`/listings/${listing.id}`).set(as(seller)).expect(200);
      expect(indexed.has(listing.id)).toBe(false);

      const second = await createPublished();
      failSearch = true;
      await api().delete(`/listings/${second.id}`).set(as(seller)).expect(200);
    });

    it("indexes upcoming listings too", async () => {
      const listing = await createPublished({}, { startsAt: new Date(Date.now() + 2 * DAY).toISOString() });
      expect(indexed.has(listing.id)).toBe(true);
    });

    it("still saves the listing when search is down, and a reindex repairs the gap", async () => {
      failSearch = true;
      const listing = await createPublished();
      expect(listing.status).toBe("PUBLISHED");
      expect(indexed.size).toBe(0);

      failSearch = false;
      await app.get(ListingsService).reindexSearch();
      expect(indexed.has(listing.id)).toBe(true);
    });

    it("reindexes only live and upcoming listings, and leaves out drafts and ended ones", async () => {
      await prisma.listing.deleteMany({ where: { sellerId } });
      const live = await createPublished({ title: "Live one" });
      const upcoming = await createPublished({ title: "Upcoming one" }, { startsAt: new Date(Date.now() + DAY).toISOString() });
      const ended = await createPublished({ title: "Ended one" });
      await prisma.listing.update({ where: { id: ended.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      await createDraft({ title: "Draft one" });
      indexed.set("stale", { id: "stale" } as ListingDocument);

      const count = await app.get(ListingsService).reindexSearch();
      const mine = [...indexed.keys()].filter((id) => [live.id, upcoming.id, ended.id].includes(id));
      expect(mine.sort()).toEqual([live.id, upcoming.id].sort());
      expect(indexed.has("stale")).toBe(false);
      expect(count).toBe(indexed.size);
    });
  });
});
