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
