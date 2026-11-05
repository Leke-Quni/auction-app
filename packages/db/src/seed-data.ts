import type { SeedBid } from "./seed-bids";
import type { OrderRow, PayoutRow, RatingRow, StrikeRow } from "./seed-orders";

export interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  passwordHash: string;
  emailVerified: Date;
  bannedAt?: Date;
  banReason?: string;
}

type Condition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR";

export interface ListingRow {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  categoryId: string;
  condition: Condition;
  startingPriceCents: number;
  reservePriceCents: number | null;
  durationDays: number;
  pickupAddress: object | null;
  extensionCount: number;
  status: "DRAFT" | "PUBLISHED";
  startsAt: Date | null;
  endsAt: Date | null;
  publishedAt: Date | null;
  currentBidCents: number | null;
  bidCount: number;
  highBidderId: string | null;
  closedAt?: Date;
  outcome?: "SOLD" | "NO_SALE" | "NO_BIDS";
  winnerId?: string | null;
  finalPriceCents?: number | null;
  removedAt?: Date;
  removedById?: string | null;
  removalReason?: string;
  createdAt: Date;
}

export interface ImageRow {
  listingId: string;
  url: string;
  pathname: string;
  position: number;
}

export interface QuestionRow {
  id: string;
  listingId: string;
  askerId: string;
  body: string;
  createdAt: Date;
  answer?: string;
  answeredAt?: Date;
  editedAt?: Date;
  answerEditedAt?: Date;
  deletedAt?: Date;
}

export interface VoteRow {
  id: string;
  questionId: string;
  userId: string;
  target: "QUESTION" | "ANSWER";
  liked: boolean;
  createdAt: Date;
}

export interface ReportRow {
  id: string;
  questionId: string;
  listingId: string;
  target: "QUESTION" | "ANSWER";
  reporterId: string | null;
  reason: "SPAM" | "ABUSE" | "CONTACT_DETAILS" | "OTHER";
  postedAt: Date;
  body: string;
  status: "OPEN" | "HANDLED";
  createdAt: Date;
  handledAt?: Date;
}

export interface QuestionLogRow {
  id: string;
  questionId: string;
  listingId: string;
  target: "QUESTION" | "ANSWER";
  action: "CREATED" | "EDITED" | "DELETED";
  actorId: string | null;
  body: string;
  previousBody?: string;
  createdAt: Date;
}

export interface WatchRow {
  userId: string;
  listingId: string;
  createdAt: Date;
}

export interface NotificationRow {
  id: string;
  userId: string;
  listingId: string;
  type: "OUTBID" | "AUCTION_EXTENDED" | "QUESTION_ASKED" | "QUESTION_ANSWERED" | "WON";
  key: string;
  title: string;
  data: object;
  readAt?: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface PendingEmailRow {
  id: string;
  userId: string;
  listingId: string;
  kind: "ENDING_SOON";
  dueAt: Date;
}

// Everything the seed writes, gathered first so it can be checked and counted before it is inserted.
export interface SeedData {
  listings: ListingRow[];
  images: ImageRow[];
  bids: SeedBid[];
  orders: OrderRow[];
  strikes: StrikeRow[];
  ratings: RatingRow[];
  payouts: PayoutRow[];
  questions: QuestionRow[];
  votes: VoteRow[];
  reports: ReportRow[];
  questionLogs: QuestionLogRow[];
  watches: WatchRow[];
  notifications: NotificationRow[];
  pendingEmails: PendingEmailRow[];
}

export const emptyData = (): SeedData => ({
  listings: [], images: [], bids: [], orders: [], strikes: [], ratings: [], payouts: [], questions: [], votes: [], reports: [], questionLogs: [], watches: [], notifications: [], pendingEmails: [],
});
