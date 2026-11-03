"use server";

import type { NotificationList } from "@auction/shared";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

// The signed-in person's latest saved notifications, or null when they cannot be loaded right now.
export async function loadNotificationsAction(): Promise<NotificationList | null> {
  if (!(await auth())) return null;
  try {
    const res = await authedApiFetch("/notifications");
    return res.ok ? ((await res.json()) as NotificationList) : null;
  } catch {
    return null;
  }
}

// Returns the new unread count, or null when it could not be marked (the next load shows the truth).
export async function markNotificationReadAction(id: string): Promise<number | null> {
  if (!(await auth())) return null;
  try {
    const res = await authedApiFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
    return res.ok ? ((await res.json()) as { unreadCount: number }).unreadCount : null;
  } catch {
    return null;
  }
}
