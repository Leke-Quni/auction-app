// Fills the development database with sample sellers and listings in every state, so lists, search and countdowns can
// be tried with realistic volume. Run it with `yarn workspace @auction/db seed [count]` (default 1000; 0 only removes
// the sample data). Everything it creates belongs to users whose email ends in @seed.local, so running it again
// replaces its own data and nothing else. It refuses to run unless the database is local. Run `yarn workspace @auction/api reindex` afterwards to update search.
import { config } from "dotenv";
import { resolve } from "node:path";
import { createPrismaClient } from "./index";
import { assertSafeToSeed } from "./seed-guard";

config({ path: resolve(__dirname, "../../../../.env") });

const SEED_EMAIL_DOMAIN = "@seed.local";
const SELLERS = 40;
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

async function main() {
  const count = Number.parseInt(process.argv[2] ?? "1000", 10);
  if (!Number.isInteger(count) || count < 0 || count > 20_000) throw new Error("Give a count between 0 and 20000");
  assertSafeToSeed(process.env);
  const prisma = createPrismaClient();
  try {
    const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
    const unknown = Object.keys(CATALOG).filter((slug) => !categories.some((c) => c.slug === slug));
    if (unknown.length > 0) throw new Error(`Missing categories: ${unknown.join(", ")}. Run the migrations first.`);

    const removed = await prisma.user.deleteMany({ where: { email: { endsWith: SEED_EMAIL_DOMAIN } } });
    console.log(`Removed ${removed.count} earlier sample sellers (and their listings).`);

    const now = Date.now();
    const sellers = Array.from({ length: SELLERS }, (_, i) => {
      const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
      const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];
      const n = String(i + 1).padStart(2, "0");
      return {
        id: `seed_user_${n}`,
        email: `seed-user-${n}${SEED_EMAIL_DOMAIN}`,
        firstName,
        lastName,
        username: `${firstName}_${lastName}`.toLowerCase().slice(0, 17) + n,
        // Not a valid hash, so nobody can sign in as a sample seller.
        passwordHash: "!sample-seller-cannot-sign-in",
        emailVerified: new Date(now),
      };
    });
    await prisma.user.createMany({ data: sellers });

    const listings = [];
    const images = [];
    const tally: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      const id = `seed_listing_${String(i + 1).padStart(5, "0")}`;
      const [slug, catalog] = pick(Object.entries(CATALOG));
      const condition = weighted(CONDITIONS);
      const noun = pick(catalog.items);
      const [mod, mod2] = [pick(catalog.mods), pick(catalog.mods)];
      const title = capitalize(weighted([[`${mod} ${noun}`, 5], [`${noun} (${mod})`, 3], [`${mod} ${noun}, ${mod2}`, 2]] as const)).slice(0, 80);
      const startingPriceCents = price();
      const when = schedule(now);
      tally[when.state] = (tally[when.state] ?? 0) + 1;
      listings.push({
        id,
        sellerId: pick(sellers).id,
        title,
        description: [pick(CONDITION_NOTES[condition]), `A ${mod} ${noun}.`, pick(EXTRA_NOTES), pick(EXTRA_NOTES)].join(" "),
        categoryId: categories.find((c) => c.slug === slug)!.id,
        condition,
        startingPriceCents,
        reservePriceCents: random() < 0.35 ? Math.round((startingPriceCents * between(1.2, 3)) / 100) * 100 : null,
        durationDays: when.days,
        status: "PUBLISHED" as const,
        startsAt: when.startsAt,
        endsAt: when.endsAt,
        publishedAt: when.publishedAt,
        createdAt: new Date(Math.min(when.publishedAt.getTime(), now) - between(3_600_000, 2 * DAY)),
      });
      const photos = weighted([[1, 40], [2, 30], [3, 20], [4, 10]] as const);
      for (let position = 0; position < photos; position++) {
        images.push({ listingId: id, url: `https://picsum.photos/seed/${id}-${position}/640/640`, pathname: `seed/${id}/${position}.jpg`, position });
      }
    }
    for (const batch of chunks(listings, 250)) await prisma.listing.createMany({ data: batch });
    for (const batch of chunks(images, 500)) await prisma.listingImage.createMany({ data: batch });
    console.log(`Created ${sellers.length} sellers, ${listings.length} listings and ${images.length} photos.`);
    console.log("By state:", JSON.stringify(tally));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
