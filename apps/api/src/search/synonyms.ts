export const SYNONYM_SET = "listing-synonyms";

export interface SynonymGroup {
  id: string;
  synonyms: string[];
  // With a root the rule is one-way: searching the root also finds the synonyms, but not the other way round.
  root?: string;
}

// Typesense matches whole words, so "shoe" does not find "shoes". These give a word and its plural.
export function plural(word: string) {
  if (/(ss|x|ch|sh)$/.test(word)) return `${word}es`;
  if (/(lf|arf)$/.test(word)) return `${word.slice(0, -1)}ves`;
  if (word.endsWith("s")) return word;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}
export const forms = (...words: string[]) => [...new Set(words.flatMap((word) => [word, plural(word)]))];

// Words that mean the same, in both directions.
const same = (id: string, ...words: string[]): SynonymGroup => ({ id, synonyms: [...new Set(words)] });

// A general word that also finds the specific ones, but not the other way round ("shoes" finds boots, "boots" does not
// find sneakers). One group per root, and a root never lists itself.
const general = (id: string, roots: string[], targets: string[]): SynonymGroup[] =>
  roots.map((root) => ({ id: `${id}-${root.replace(/ /g, "-")}`, root, synonyms: [...new Set(targets)].filter((target) => target !== root) }));

const shoeTypes = forms("sneaker", "boot", "trainer", "loafer", "sandal", "heel", "slipper");
const clothingTypes = forms("jacket", "coat", "jeans", "dress", "sweater", "scarf", "shirt", "trousers", "skirt", "blouse", "hoodie", "suit");
const jewelleryTypes = forms("necklace", "ring", "earring", "bracelet", "brooch", "cufflink", "pendant", "bangle", "anklet");
const furnitureTypes = forms("table", "chair", "armchair", "sofa", "couch", "bookshelf", "shelf", "cabinet", "desk", "wardrobe", "bed");
const toyTypes = forms("lego", "puzzle", "doll", "teddy", "plush", "action figure", "model train", "board game", "remote control car", "miniature");
const bookTypes = forms("novel", "first edition", "atlas", "cookbook", "anthology", "encyclopaedia", "textbook", "paperback", "hardcover");
const artTypes = forms("painting", "sculpture", "print", "drawing", "canvas", "portrait", "landscape", "woodcut", "linocut", "figurine", "photograph");
const collectibleTypes = forms("coin", "stamp", "medal", "card", "postcard", "pin", "badge", "memorabilia", "ticket");
const toolTypes = forms("hammer", "saw", "wrench", "spanner", "drill", "screwdriver", "pliers", "chisel", "plane");

// Words people search with that the listings may not use. They are pushed to Typesense when the API starts, so a change
// here takes effect on the next start.
export const LISTING_SYNONYMS: SynonymGroup[] = [
  // Fashion and footwear
  ...general("shoes", ["shoes", "shoe"], [...forms("shoe"), ...shoeTypes]),
  ...general("footwear", ["footwear"], [...forms("shoe"), ...shoeTypes]),
  same("sneakers", ...forms("sneaker", "trainer")),
  same("trousers", ...forms("trouser", "pant")),
  same("sweater", ...forms("sweater", "jumper", "pullover")),
  same("denim", "jeans", "denim"),
  same("handbag", ...forms("handbag", "purse")),
  ...general("bag", ["bag", "bags"], [...forms("handbag", "purse", "backpack", "suitcase", "tote", "satchel")]),
  same("sunglasses", "sunglasses", "shades"),
  same("dress", ...forms("dress", "gown")),
  same("scarf", "scarf", "scarves", "shawl", "shawls"),
  ...general("hat", ["hat", "hats"], forms("cap", "beanie", "fedora")),
  ...general("outerwear", ["outerwear"], forms("jacket", "coat", "parka", "blazer", "anorak")),
  ...general("clothes", ["clothes", "clothing", "apparel", "garments", "outfit"], clothingTypes),
  same("bangle", ...forms("bracelet", "bangle")),
  ...general("jewelry", ["jewelry", "jewellery", "jewels"], jewelleryTypes),
  same("silver", "silver", "sterling"),

  // Watches
  same("watch", ...forms("watch", "wristwatch", "timepiece")),
  ...general("watches", ["watch", "watches"], forms("chronograph", "smartwatch")),
  same("smartwatch", ...forms("smartwatch"), "smart watch", "smart watches"),

  // Electronics
  ...general("phone", ["phone", "phones"], [...forms("smartphone", "mobile", "iphone"), "android"]),
  same("smartphone", ...forms("smartphone"), "mobile phone", "mobile phones", "cell phone", "cell phones"),
  same("laptop", ...forms("laptop", "notebook")),
  ...general("computer", ["computer", "computers"], forms("laptop", "notebook", "desktop", "pc")),
  same("tv", ...forms("tv", "television")),
  same("headphones", "headphones", "earphones", "earbuds", "headset", "headsets"),
  ...general("audio", ["audio", "sound"], [...forms("headphone", "speaker", "amplifier"), "earphones", "earbuds", "record player", "turntable"]),
  same("tablet", ...forms("tablet", "ipad")),
  ...general("console", ["console", "consoles"], [...forms("playstation", "xbox", "nintendo"), "game console", "game consoles"]),
  ...general("photography", ["photography", "photo", "photos"], [...forms("camera", "tripod", "photograph"), "lens", "lenses"]),
  same("drone", ...forms("drone", "quadcopter")),
  same("wireless", "wireless", "cordless"),
  same("resolution", "4k", "uhd", "ultra hd"),
  same("refurbished", "refurbished", "renewed", "reconditioned"),

  // Home and garden
  same("sofa", ...forms("sofa", "couch", "settee")),
  ...general("furniture", ["furniture"], furnitureTypes),
  same("rug", ...forms("rug", "carpet")),
  ...general("lighting", ["lighting", "lights"], forms("lamp", "lantern", "chandelier")),
  same("cushion", ...forms("cushion", "pillow")),
  same("fridge", ...forms("fridge", "refrigerator")),
  ...general("cookware", ["cookware", "kitchenware"], forms("pan", "pot", "skillet", "wok", "saucepan")),
  ...general("gardening", ["gardening", "garden"], forms("planter", "plant pot", "spade", "shovel", "rake")),
  same("bookshelf", ...forms("bookshelf", "bookcase")),
  ...general("decor", ["decor", "decoration", "decorations"], forms("vase", "ornament", "figurine", "mirror", "picture frame", "wall clock")),

  // Art
  ...general("art", ["art", "artwork", "artworks"], artTypes),
  ...general("picture", ["picture", "pictures"], forms("painting", "print", "photograph", "drawing", "portrait")),
  same("sculpture", ...forms("sculpture", "statue", "statuette")),
  same("encyclopaedia", "encyclopaedia", "encyclopedia", "encyclopaedias", "encyclopedias"),

  // Books and media
  ...general("books", ["book", "books"], bookTypes),
  same("vinyl", "vinyl", "record", "records", "lp", "lps"),
  ...general("movies", ["movie", "movies"], [...forms("film", "dvd"), "box set", "box sets"]),
  same("magazine", ...forms("magazine", "periodical")),
  same("comic", ...forms("comic"), "comic book", "comic books"),
  same("cookbook", ...forms("cookbook"), "cook book", "recipe book", "recipe books"),
  same("sheet-music", "sheet music", "score", "scores"),

  // Toys and games
  ...general("toys", ["toy", "toys"], toyTypes),
  same("kids", "kids", "children", "childrens"),
  same("kid", "kid", "child"),
  same("teddy", ...forms("teddy", "plush"), "teddy bear", "teddy bears", "stuffed animal", "stuffed animals"),
  same("puzzle", ...forms("puzzle", "jigsaw")),
  same("board-game", "boardgame", "boardgames", "board game", "board games"),
  same("lego", "lego", "building blocks", "bricks"),
  same("remote-control", "rc", "remote control"),
  same("doll", ...forms("doll", "dolly")),

  // Sports and outdoors
  same("bike", ...forms("bike", "bicycle", "cycle")),
  ...general("cycling", ["cycling"], forms("bike", "bicycle")),
  same("mountain-bike", "mtb", "mountain bike", "mountain bikes"),
  same("tent", ...forms("tent"), "camping tent", "camping tents"),
  ...general("camping", ["camping"], [...forms("tent", "stove", "lantern"), "sleeping bag", "sleeping bags"]),
  ...general("hiking", ["hiking", "trekking"], forms("boot", "backpack", "pole")),
  same("racket", ...forms("racket", "racquet")),
  same("football", "football", "soccer"),
  same("fishing", "fishing rod", "fishing rods", "fishing pole", "fishing poles"),
  ...general("fitness", ["fitness", "gym", "workout", "exercise"], [...forms("yoga mat", "dumbbell", "kettlebell", "treadmill", "weight"), "exercise bike"]),

  // Collectibles
  ...general("collectibles", ["collectible", "collectibles", "collectable", "collectables", "memorabilia"], collectibleTypes),
  same("collectible", "collectible", "collectibles", "collectable", "collectables"),
  same("coin", ...forms("coin"), "numismatic"),
  same("stamp", ...forms("stamp"), "philatelic"),
  same("badge", ...forms("pin", "badge")),
  same("postcard", ...forms("postcard"), "post card", "post cards"),

  // Other
  same("suitcase", ...forms("suitcase", "luggage")),
  ...general("tools", ["tool", "tools"], toolTypes),
  same("wrench", ...forms("wrench", "spanner")),

  // Condition and description
  same("vintage", "vintage", "retro"),
  ...general("old", ["old"], ["vintage", "antique", "retro", "antiques"]),
  same("used", "used", "preowned", "pre owned", "secondhand", "second hand"),
  same("unworn", "unworn", "unused"),
  same("sealed", "sealed", "unopened"),
  same("mint", "mint", "pristine"),
  same("damaged", "damaged", "broken", "faulty"),
  same("large", "large", "big"),
  ...general("small", ["small", "tiny"], ["compact", "mini", "miniature", "petite", "small", "tiny"]),
  same("miniature", "mini", "miniature"),
  same("signed", "signed", "autographed"),
  same("handmade", "handmade", "hand made", "handcrafted", "hand crafted"),
  same("wood", "wood", "wooden"),
  same("waterproof", "waterproof", "water resistant"),

  // Spelling
  same("jewelry-spelling", "jewelry", "jewellery"),
  same("watercolour-spelling", "watercolour", "watercolor", "watercolours", "watercolors"),
  same("colour-spelling", "colour", "color", "colours", "colors"),
  same("grey-spelling", "grey", "gray"),
  same("catalogue-spelling", "catalogue", "catalog"),
  same("aluminium-spelling", "aluminium", "aluminum"),
  same("tyre-spelling", "tyre", "tire", "tyres", "tires"),
  same("pyjamas-spelling", "pyjamas", "pajamas"),
];
