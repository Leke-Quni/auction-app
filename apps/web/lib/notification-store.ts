import type { NotificationItem, NotificationList } from "@auction/shared";
import { create } from "zustand";

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  // True when something arrived or changed since the list was loaded, so it is fetched again the next time it is opened.
  stale: boolean;
  seed: (list: NotificationList | null) => void;
  setUnread: (unreadCount: number) => void;
  markRead: (id: string, unreadCount?: number) => void;
  reset: () => void;
}

// Live state for the bell: the saved notifications last loaded, and the unread count the server last announced. Only
// touched in the browser, from effects and socket events.
export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,
  stale: true,
  seed: (list) => set(list ? { items: list.items, unreadCount: list.unreadCount, stale: false } : { stale: true }),
  setUnread: (unreadCount) => set({ unreadCount, stale: true }),
  markRead: (id, unreadCount) =>
    set((state) => {
      const target = state.items.find((item) => item.id === id);
      const wasUnread = target !== undefined && target.readAt === null;
      return {
        items: state.items.map((item) => (item.id === id && item.readAt === null ? { ...item, readAt: new Date().toISOString() } : item)),
        unreadCount: unreadCount ?? Math.max(0, state.unreadCount - (wasUnread ? 1 : 0)),
      };
    }),
  reset: () => set({ items: [], unreadCount: 0, stale: true }),
}));
