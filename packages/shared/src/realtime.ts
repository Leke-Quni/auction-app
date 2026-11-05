// What the API pushes over the WebSocket. Rooms: `auction:<listingId>` (anyone viewing) and `user:<userId>` (private).
export const AUCTION_ROOM_PREFIX = "auction:";
export const USER_ROOM_PREFIX = "user:";
export const auctionRoom = (listingId: string) => `${AUCTION_ROOM_PREFIX}${listingId}`;
export const userRoom = (userId: string) => `${USER_ROOM_PREFIX}${userId}`;

export const SOCKET_EVENTS = {
  watch: "watch",
  unwatch: "unwatch",
  bidPlaced: "bid:placed",
  auctionExtended: "auction:extended",
  outbid: "notice:outbid",
  extendedNotice: "notice:extended",
  wonNotice: "notice:won",
  questionNotice: "notice:question",
  answerNotice: "notice:answer",
  unread: "notifications:unread",
} as const;

export interface BidPlacedEvent {
  listingId: string;
  currentBidCents: number;
  bidCount: number;
  highBidder: { id: string; username: string };
  endsAt: string;
  extensionCount: number;
  minimumNextBidCents: number;
  serverTime: string;
  extended: boolean;
  // The row for the history table.
  bid: { id: string; amountCents: number; createdAt: string; bidder: { id: string; username: string } };
}

export interface AuctionExtendedEvent {
  listingId: string;
  endsAt: string;
  extensionCount: number;
  serverTime: string;
}

// Private notices, sent only to the `user:<id>` room of the person concerned.
export interface OutbidNotice {
  listingId: string;
  title: string;
  currentBidCents: number;
  minimumNextBidCents: number;
  endsAt: string;
  // True when the bid that outbid you also moved the end time.
  extended: boolean;
  extensionCount: number;
}

// For every other bidder on an auction whose end time just moved.
export interface ExtendedNotice {
  listingId: string;
  title: string;
  endsAt: string;
  extensionCount: number;
  // True when the end time has reached its ceiling: the auction cannot be extended again.
  final: boolean;
}

// For the winner of an auction, when it closes in a sale (`notice:won`).
export interface WonNotice {
  listingId: string;
  title: string;
  finalPriceCents: number;
  // True when the item is offered to this bidder because the winner did not pay, rather than won outright.
  offered?: boolean;
  // The order to pay, so the bell can link straight to the pay page.
  orderId?: string;
}

// For the seller when someone asks a question on their listing (`notice:question`), and for the asker when the seller
// answers it (`notice:answer`). `from` is the username of the other person; `excerpt` is the start of the text.
export interface QuestionNotice {
  listingId: string;
  questionId: string;
  title: string;
  from: string;
  excerpt: string;
}

// Sent to `user:<id>` after the person's saved notifications change, so the bell can show the count without asking.
export interface UnreadEvent {
  unreadCount: number;
}

// Saved notifications live this long, and the bell lists this many.
export const NOTIFICATION_TTL_DAYS = 14;
export const NOTIFICATION_LIST_SIZE = 20;

interface NotificationBase {
  id: string;
  listingId: string;
  title: string;
  readAt: string | null;
  createdAt: string;
}

export type NotificationItem =
  | (NotificationBase & { type: "OUTBID"; data: OutbidNotice })
  | (NotificationBase & { type: "AUCTION_EXTENDED"; data: ExtendedNotice })
  | (NotificationBase & { type: "QUESTION_ASKED"; data: QuestionNotice })
  | (NotificationBase & { type: "QUESTION_ANSWERED"; data: QuestionNotice })
  | (NotificationBase & { type: "WON"; data: WonNotice });

export interface NotificationList {
  items: NotificationItem[];
  unreadCount: number;
}
