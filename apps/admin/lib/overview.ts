import { cache } from "react";
import { adminApiFetch } from "@/lib/api";

export interface Overview {
  openReports: number;
  liveListings: number;
  upcomingListings: number;
  awaitingPaymentOrders: number;
  paidOrdersToShip: number;
  bannedUsers: number;
  users: number;
}

// Shared by the layout (sidebar badge) and the Overview page of one request.
export const getOverview = cache(async (): Promise<Overview> => {
  const res = await adminApiFetch("/admin/overview");
  if (!res.ok) throw new Error(`API /admin/overview failed: ${res.status}`);
  return res.json();
});
