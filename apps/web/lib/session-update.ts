import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";

export interface SessionUpdate {
  name?: string;
  email?: string;
  sessionVersion?: number;
}

// Auth.js hands the jwt callback whatever a browser posts to /api/auth/session, so the values a session may change to are never
// read from that. Server code that got them from the API runs the update inside `withSessionUpdate`; a browser's own request has
// nothing here and changes nothing.
const pending = new AsyncLocalStorage<SessionUpdate>();

export const withSessionUpdate = <T>(update: SessionUpdate, fn: () => Promise<T>) => pending.run(update, fn);

export function jwtCallback({ token, user, trigger }: { token: JWT; user?: User; trigger?: string }): JWT {
  if (user) {
    token.id = user.id!;
    token.role = user.role;
    token.sv = user.sessionVersion;
  }
  const update = trigger === "update" ? pending.getStore() : undefined;
  if (update) {
    if (update.name) token.name = update.name;
    if (update.email) token.email = update.email;
    if (typeof update.sessionVersion === "number") token.sv = update.sessionVersion;
  }
  return token;
}
