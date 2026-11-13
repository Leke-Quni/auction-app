// Fills a database with sample accounts and listings in every state, plus named scenarios for every feature (orders at each
// stage, reports, strikes, a banned account, questions, watchlists, notifications), so lists, search, countdowns, bidding and
// the admin app can be tried with realistic volume.
//   yarn workspace @auction/db seed [count] [--users N] [--owner email] [--allow-remote --confirm-host <host>]
// `count` is the number of listings (default 1000; 0 only removes the sample data), `--users` the number of sample accounts
// (default 40). `--owner` is a real account that already exists, which is given a bit of everything to try from a real
// sign-in. Everything it creates has an id starting "seed_" or belongs to an account whose email ends in @seed.local, so
// running it again replaces its own data and nothing else. It refuses to run unless the database is local, unless you add
// --allow-remote and type the database's host after --confirm-host. Run `yarn workspace @auction/api reindex` afterwards to
// update Typesense (a deployment that searches Postgres needs nothing).
import { config } from "dotenv";
import { resolve } from "node:path";
import type { ShippingAddress } from "@auction/shared";
import { createPrismaClient } from "./index";
import { autoBidsOf, generateBids, type SeedBid } from "./seed-bids";
import { parseSeedArgs } from "./seed-args";
import { emptyData, type ListingRow, type SeedData, type UserRow } from "./seed-data";
import { planSale } from "./seed-orders";
import { buildScenarios } from "./seed-scenarios";
import { assertSafeToSeed } from "./seed-guard";

config({ path: resolve(__dirname, "../../../../.env") });

// Where the carrier collects sample items (the reference countries), so a sample win can be paid and delivered.
const PICKUPS: ShippingAddress[] = [
  { name: "Sample Seller", line1: "Rr. Dardania 12", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344000111" },
  { name: "Sample Seller", line1: "Rr. Adem Jashari 5", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344000222" },
  { name: "Sample Seller", line1: "Rruga e Durresit 30", city: "Tirana", postcode: "1001", country: "AL", phone: "+355690000333" },
  { name: "Sample Seller", line1: "Ul. Makedonija 8", city: "Skopje", postcode: "1000", country: "MK", phone: "+38970000444" },
];

// Where sample buyers are sent their parcels.
const DELIVERIES: ShippingAddress[] = [
  { name: "Arta Krasniqi", line1: "Rr. Agim Ramadani 3", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344123456" },
  { name: "Blerta Gashi", line1: "Rr. Skenderbeu 18", city: "Gjakova", postcode: "50000", country: "XK", phone: "+38344765432" },
  { name: "Ermal Hoxha", line1: "Rruga Myslym Shyri 7", city: "Tirana", postcode: "1001", country: "AL", phone: "+355691234567" },
  { name: "Dritan Leka", line1: "Rruga Kavajes 22", city: "Durres", postcode: "2001", country: "AL", phone: "+355692345678" },
  { name: "Marija Stojanov", line1: "Ul. Partizanska 41", city: "Skopje", postcode: "1000", country: "MK", phone: "+38970123456" },
  { name: "Goran Dimitrov", line1: "Ul. Gjuro Gjakovikj 9", city: "Tetovo", postcode: "1200", country: "MK", phone: "+38971234567" },
];

const SEED_EMAIL_DOMAIN = "@seed.local";
const DAY = 86_400_000;

// Small seeded generator, so the same count always produces the same items (only the times follow the clock).
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261102);
// Bids have their own stream, so adding them did not change which listings a given count produces.
const bidRandom = mulberry32(20261103);
const between = (min: number, max: number) => min + random() * (max - min);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
const weighted = <T>(choices: readonly (readonly [T, number])[]) => {
  let roll = random() * choices.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of choices) if ((roll -= weight) < 0) return value;
  return choices[choices.length - 1][0];
};
const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);

const CATALOG: Record<string, { items: string[]; mods: string[] }> = {
  collectibles: {
    items: ["postage stamp album", "coin set", "baseball card lot", "postcard collection", "commemorative medal", "enamel pin set", "trading card binder", "antique key collection", "matchbox label collection", "ticket stub collection"],
    mods: ["rare", "vintage", "complete", "mint", "1960s", "1980s", "signed", "limited edition"],
  },
  "watches-jewelry": {
    items: ["wristwatch", "pocket watch", "silver necklace", "gold ring", "pearl earrings", "charm bracelet", "cufflinks", "brooch", "chronograph", "dive watch"],
    mods: ["Swiss", "automatic", "quartz", "vintage", "925 silver", "14k gold", "art deco", "handmade"],
  },
  electronics: {
    items: ["film camera", "laptop", "smartphone", "headphones", "record player", "game console", "tablet", "bluetooth speaker", "mechanical keyboard", "drone", "smartwatch", "monitor"],
    mods: ["refurbished", "boxed", "2019", "retro", "wireless", "4K", "professional", "compact"],
  },
  fashion: {
    items: ["leather jacket", "denim jeans", "wool coat", "sneakers", "handbag", "silk scarf", "sunglasses", "summer dress", "ankle boots", "wool sweater"],
    mods: ["designer", "vintage", "size M", "size L", "limited", "handmade", "unworn", "genuine leather"],
  },
  "home-garden": {
    items: ["ceramic vase", "oak coffee table", "garden tool set", "floor lamp", "wool rug", "cast iron pan", "bookshelf", "armchair", "wall clock", "plant pot set"],
    mods: ["mid-century", "rustic", "hand-painted", "solid wood", "antique", "modern", "Scandinavian", "industrial"],
  },
  art: {
    items: ["oil painting", "watercolour landscape", "bronze sculpture", "signed print", "charcoal portrait", "ceramic figurine", "woodcut", "abstract canvas", "framed photograph", "linocut"],
    mods: ["original", "framed", "signed", "miniature", "large", "19th century", "contemporary", "limited run"],
  },
  "books-media": {
    items: ["first edition novel", "vinyl record", "comic book run", "world atlas", "cookbook collection", "DVD box set", "encyclopaedia set", "poetry anthology", "sheet music", "magazine lot"],
    mods: ["signed", "rare", "hardcover", "1970s", "complete", "collector's", "sealed", "illustrated"],
  },
  "toys-games": {
    items: ["board game", "LEGO set", "action figure", "model train", "jigsaw puzzle", "teddy bear", "chess set", "porcelain doll", "remote control car", "tabletop miniatures"],
    mods: ["vintage", "sealed", "complete", "retro", "wooden", "limited", "1990s", "collector"],
  },
  "sports-outdoors": {
    items: ["road bicycle", "tent", "hiking boots", "tennis racket", "climbing harness", "fishing rod", "football boots", "ski goggles", "camping stove", "yoga mat set"],
    mods: ["lightly used", "professional", "lightweight", "carbon", "waterproof", "size 42", "4-season", "compact"],
  },
  other: {
    items: ["mystery box", "antique tool", "vintage suitcase", "typewriter", "music box", "telescope", "candle collection", "map reproduction", "lantern", "sewing machine"],
    mods: ["unusual", "antique", "handmade", "restored", "vintage", "working", "decorative", "rare"],
  },
};

const CONDITIONS = [["NEW", 15], ["LIKE_NEW", 20], ["GOOD", 35], ["FAIR", 20], ["POOR", 10]] as const;
const CONDITION_NOTES = {
  NEW: ["Brand new and never used.", "Still in its original packaging."],
  LIKE_NEW: ["Barely used, with no visible wear.", "Looks and works like new."],
  GOOD: ["In good order, with minor signs of use.", "Well looked after and fully working."],
  FAIR: ["Shows clear wear but works as it should.", "Some scratches and marks, priced accordingly."],
  POOR: ["Heavy wear, sold for parts or restoration.", "Needs work, so look closely at the photos."],
} as const;
const EXTRA_NOTES = [
  "Pickup or tracked shipping within the region.",
  "The photos show the actual item.",
  "Comes from a smoke-free home.",
  "Happy to answer questions before you bid.",
  "Part of a private collection, being sold on.",
  "Packed carefully and sent within two days of payment.",
];
const DURATIONS = [[1, 15], [3, 20], [5, 20], [7, 30], [30, 15]] as const;
const FIRST_NAMES = ["Arben", "Elira", "Blerim", "Drita", "Fatos", "Gentiana", "Ilir", "Jeta", "Kujtim", "Lule", "Mentor", "Nora", "Orges", "Pranvera", "Qazim", "Rina", "Shpend", "Teuta", "Valon", "Zana", "Marko", "Ana", "Stefan", "Ivana", "Nikola", "Marija", "Goran", "Elena", "Dimitar", "Sara", "Luan", "Mira", "Besnik", "Vesa", "Agim", "Lirie", "Petar", "Katerina", "Altin", "Erjona"];
const LAST_NAMES = ["Krasniqi", "Hoxha", "Berisha", "Gashi", "Shala", "Morina", "Rexhepi", "Dervishi", "Kelmendi", "Bytyqi", "Petrovski", "Stojanov", "Ivanovski", "Dimitrov", "Nikolov", "Gjoka", "Basha", "Hysi", "Prifti", "Leka"];

function price() {
  const euros = weighted([[() => Math.exp(between(Math.log(1), Math.log(60))), 60], [() => Math.exp(between(Math.log(60), Math.log(600))), 30], [() => Math.exp(between(Math.log(600), Math.log(6000))), 9], [() => Math.exp(between(Math.log(6000), Math.log(60000))), 1]])();
  const step = euros < 20 ? 1 : euros < 100 ? 5 : euros < 1000 ? 10 : 50;
  return Math.max(1, Math.round(euros / step) * step) * 100;
}

function schedule(now: number) {
  const days = weighted(DURATIONS);
  const state = weighted([["live", 52], ["endingSoon", 8], ["upcoming", 28], ["ended", 12]] as const);
  let startsAt: number;
  if (state === "live") startsAt = now - between(0.02, 0.98) * days * DAY;
  else if (state === "endingSoon") {
    const remaining = weighted([[between(60_000, 600_000), 10], [between(600_000, 3 * 3_600_000), 40], [between(3 * 3_600_000, DAY), 50]] as const);
    startsAt = now + remaining - days * DAY;
  } else if (state === "upcoming") startsAt = now + between(10 * 60_000, 30 * DAY);
  else startsAt = now - between(3_600_000, 20 * DAY) - days * DAY;
  const endsAt = startsAt + days * DAY;
  const publishedAt = state === "upcoming" ? now - between(3_600_000, 5 * DAY) : startsAt;
  return { days, state, startsAt: new Date(startsAt), endsAt: new Date(endsAt), publishedAt: new Date(publishedAt) };
}

const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const START_OF = "seed_";

async function main() {
  const args = parseSeedArgs(process.argv.slice(2));
  assertSafeToSeed(process.env, args);
  const prisma = createPrismaClient();
  try {
    const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
    const unknown = Object.keys(CATALOG).filter((slug) => !categories.some((c) => c.slug === slug));
    if (unknown.length > 0) throw new Error(`Missing categories: ${unknown.join(", ")}. Run the migrations first.`);
    const categoryId = (slug: string) => {
      const category = categories.find((c) => c.slug === slug);
      if (!category) throw new Error(`Missing category ${slug}`);
      return category.id;
    };
    let owner: { id: string; username: string } | null = null;
    if (args.owner && args.count > 0) {
      owner = await prisma.user.findUnique({ where: { email: args.owner }, select: { id: true, username: true } });
      if (!owner) throw new Error(`No account with the email ${args.owner}: sign up on the site first, then run the seed again.`);
    }

    // Everything the seed makes has an id starting "seed_" (listings, orders and the rest) or is a sample account, so it can be
    // found again. Rows that point at each other must go in the right order: the records with no foreign keys, then what the
    // orders carry, the orders, the bids (a listing with a bid cannot be deleted), the listings (which take their photos,
    // questions, votes, watches and notifications with them), and last the accounts (which take their strikes).
    const sample = { email: { endsWith: SEED_EMAIL_DOMAIN } };
    const mine = { startsWith: START_OF };
    const realListingsBidOn = await prisma.bid.findMany({
      where: { bidder: sample, NOT: { listingId: mine } },
      distinct: ["listingId"],
      select: { listingId: true },
    });
    await prisma.report.deleteMany({ where: { listingId: mine } });
    await prisma.questionLog.deleteMany({ where: { listingId: mine } });
    await prisma.pendingEndEmail.deleteMany({ where: { OR: [{ listingId: mine }, { userId: mine }] } });
    await prisma.pendingOutbidEmail.deleteMany({ where: { OR: [{ listingId: mine }, { userId: mine }] } });
    await prisma.bidAudit.deleteMany({ where: { OR: [{ listingId: mine }, { userId: mine }] } });
    await prisma.rating.deleteMany({ where: { order: { listingId: mine } } });
    await prisma.payout.deleteMany({ where: { order: { listingId: mine } } });
    await prisma.strike.deleteMany({ where: { listingId: mine } });
    await prisma.order.deleteMany({ where: { listingId: mine } });
    await prisma.bid.deleteMany({ where: { OR: [{ bidder: sample }, { listingId: mine }] } });
    for (const { listingId } of realListingsBidOn) {
      const top = await prisma.bid.findFirst({ where: { listingId }, orderBy: [{ amountCents: "desc" }, { id: "desc" }] });
      const bidCount = await prisma.bid.count({ where: { listingId } });
      await prisma.listing.update({ where: { id: listingId }, data: { currentBidCents: top?.amountCents ?? null, bidCount, highBidderId: top?.bidderId ?? null } });
    }
    const removedListings = await prisma.listing.deleteMany({ where: { id: mine } });
    const removed = await prisma.user.deleteMany({ where: sample });
    console.log(`Removed ${removed.count} earlier sample accounts and ${removedListings.count} sample listings (with their orders, bids and the rest).`);
    if (realListingsBidOn.length > 0) console.log(`Took sample bids off ${realListingsBidOn.length} other listings.`);
    if (args.count === 0) return;

    const now = Date.now();
    const users: UserRow[] = Array.from({ length: args.users }, (_, i) => {
      const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
      const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];
      const n = String(i + 1).padStart(4, "0");
      return {
        id: `seed_user_${n}`,
        email: `seed-user-${n}${SEED_EMAIL_DOMAIN}`,
        firstName,
        lastName,
        username: `${firstName}_${lastName}`.toLowerCase().slice(0, 16) + n,
        // Not a valid hash, so nobody can sign in as a sample account.
        passwordHash: "!sample-account-cannot-sign-in",
        emailVerified: new Date(now),
      };
    });

    const next = (() => {
      let counter = 0;
      return () => ++counter;
    })();
    const data: SeedData = emptyData();
    const bidderIds = users.map((user) => user.id);
    const finalChance = (when: { state: string }, i: number) => (when.state === "live" || when.state === "endingSoon") && i % 40 === 0;
    const tally: Record<string, number> = {};
    for (let i = 0; i < args.count; i++) {
      const id = `seed_listing_${String(i + 1).padStart(5, "0")}`;
      const [slug, catalog] = pick(Object.entries(CATALOG));
      const condition = weighted(CONDITIONS);
      const noun = pick(catalog.items);
      const [mod, mod2] = [pick(catalog.mods), pick(catalog.mods)];
      const title = capitalize(weighted([[`${mod} ${noun}`, 5], [`${noun} (${mod})`, 3], [`${mod} ${noun}, ${mod2}`, 2]] as const)).slice(0, 80);
      const startingPriceCents = price();
      const when = schedule(now);
      tally[when.state] = (tally[when.state] ?? 0) + 1;
      const endsAt = finalChance(when, i) ? new Date(when.endsAt.getTime() + DAY) : when.endsAt;
      const sellerId = pick(users).id;
      const placed = generateBids({ id, sellerId, startingPriceCents, startsAt: when.startsAt, endsAt }, bidderIds, now, bidRandom);
      const pickup = pick(PICKUPS);
      const reservePriceCents = random() < 0.35 ? Math.round((startingPriceCents * between(1.2, 3)) / 100) * 100 : null;
      const listing: ListingRow = {
        id,
        sellerId,
        title,
        description: [pick(CONDITION_NOTES[condition]), `A ${mod} ${noun}.`, pick(EXTRA_NOTES), pick(EXTRA_NOTES)].join(" "),
        categoryId: categoryId(slug),
        condition,
        startingPriceCents,
        reservePriceCents,
        durationDays: when.days,
        pickupAddress: pickup,
        // A few live auctions that have been extended right up to the ceiling, so the "Final chance to bid" tag has data.
        extensionCount: finalChance(when, i) ? 30 : 0,
        status: "PUBLISHED",
        startsAt: when.startsAt,
        endsAt,
        currentBidCents: placed.currentBidCents,
        bidCount: placed.bidCount,
        highBidderId: placed.highBidderId,
        publishedAt: when.publishedAt,
        createdAt: new Date(Math.min(when.publishedAt.getTime(), now) - between(3_600_000, 2 * DAY)),
      };
      // An auction that has ended was closed the way the app closes one: no bids, the reserve not met, or sold to the high
      // bidder, and a sale has an order, which may have been paid, shipped, delivered, rated, or not paid at all.
      if (when.state === "ended") {
        listing.closedAt = new Date(Math.min(endsAt.getTime() + 3000, now));
        listing.winnerId = null;
        listing.finalPriceCents = null;
        if (placed.bidCount === 0) listing.outcome = "NO_BIDS";
        else if (reservePriceCents !== null && placed.currentBidCents! < reservePriceCents) listing.outcome = "NO_SALE";
        else {
          const plan = planSale(
            { listingId: id, sellerId, closedAt: listing.closedAt, reservePriceCents, pickupAddress: pickup, bids: placed.bids, winnerId: placed.highBidderId!, finalPriceCents: placed.currentBidCents! },
            now,
            { random: bidRandom, addresses: DELIVERIES, next },
          );
          data.orders.push(...plan.orders);
          data.strikes.push(...plan.strikes);
          data.ratings.push(...plan.ratings);
          data.payouts.push(...plan.payouts);
          // The result follows the last order: a sale to whoever finally paid, or none if nobody did.
          listing.outcome = plan.listing.outcome;
          listing.winnerId = plan.listing.winnerId;
          listing.finalPriceCents = plan.listing.finalPriceCents;
        }
      }
      data.listings.push(listing);
      data.bids.push(...placed.bids);
      const photos = weighted([[1, 40], [2, 30], [3, 20], [4, 10]] as const);
      for (let position = 0; position < photos; position++) {
        data.images.push({ listingId: id, url: `https://picsum.photos/seed/${id}-${position}/640/640`, pathname: `seed/${id}/${position}.jpg`, position });
      }
    }

    const scenarios = buildScenarios({ now, users, ownerId: owner?.id ?? null, categoryId, addresses: DELIVERIES, pickups: PICKUPS, next });
    for (const key of Object.keys(data) as (keyof SeedData)[]) (data[key] as unknown[]).push(...scenarios.data[key]);
    // The maximum each bidder holds on each auction follows from the bids.
    data.autoBids = autoBidsOf(data.bids);

    // Insertion, in the order the rows depend on each other.
    const insert = async (name: string, rows: unknown[], size: number, write: (batch: never[]) => Promise<unknown>) => {
      for (const batch of chunks(rows, size)) await write(batch as never[]);
      return `${rows.length} ${name}`;
    };
    await prisma.user.createMany({ data: users as never });
    const done = [
      `${users.length} sample accounts`,
      await insert("listings", data.listings, 250, (d) => prisma.listing.createMany({ data: d })),
      await insert("photos", data.images, 500, (d) => prisma.listingImage.createMany({ data: d })),
      await insert("bids", data.bids as SeedBid[], 500, (d) => prisma.bid.createMany({ data: d })),
      await insert("maximum bids", data.autoBids, 500, (d) => prisma.autoBid.createMany({ data: d })),
      await insert("orders", data.orders, 250, (d) => prisma.order.createMany({ data: d })),
      await insert("strikes", data.strikes, 500, (d) => prisma.strike.createMany({ data: d })),
      await insert("payouts", data.payouts, 500, (d) => prisma.payout.createMany({ data: d })),
      await insert("ratings", data.ratings, 500, (d) => prisma.rating.createMany({ data: d })),
      await insert("questions", data.questions, 500, (d) => prisma.question.createMany({ data: d })),
      await insert("votes", data.votes, 500, (d) => prisma.questionVote.createMany({ data: d })),
      await insert("reports", data.reports, 500, (d) => prisma.report.createMany({ data: d })),
      await insert("question log entries", data.questionLogs, 500, (d) => prisma.questionLog.createMany({ data: d })),
      await insert("watches", data.watches, 500, (d) => prisma.watch.createMany({ data: d })),
      await insert("notifications", data.notifications, 500, (d) => prisma.notification.createMany({ data: d })),
      await insert("queued emails", data.pendingEmails, 500, (d) => prisma.pendingEndEmail.createMany({ data: d })),
    ];
    console.log(`Created ${done.join(", ")}.`);
    console.log("Bulk listings by state:", JSON.stringify(tally));
    if (owner) console.log(`Attached the scenarios to ${args.owner} (@${owner.username}).`);
    for (const line of scenarios.notes) console.log(`- ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
