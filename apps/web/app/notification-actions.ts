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

// Removes one notification from the inbox. Returns the new unread count, or null when it could not be removed.
export async function dismissNotificationAction(id: string): Promise<number | null> {
  if (!(await auth())) return null;
  try {
    const res = await authedApiFetch(`/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok ? ((await res.json()) as { unreadCount: number }).unreadCount : null;
  } catch {
    return null;
  }
}

// Empties the inbox. True when it was cleared.
export async function clearNotificationsAction(): Promise<boolean> {
  if (!(await auth())) return false;
  try {
    return (await authedApiFetch("/notifications", { method: "DELETE" })).ok;
  } catch {
    return false;
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
