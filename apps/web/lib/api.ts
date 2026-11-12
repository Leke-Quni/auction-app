import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { encodeJwt } from "@/lib/jwt";

const apiUrl = () => process.env.API_URL ?? "http://localhost:4000";

// Every call is fresh unless the caller says a value may be reused for a while (see `rarelyChanging`).
export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${apiUrl()}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

// For public data that hardly ever changes, kept by Next for `seconds` and shared by every visitor, so a page does not cross to
// the API for it each time.
export const rarelyChanging = (seconds: number): RequestInit => ({ cache: "force-cache", next: { revalidate: seconds } });

// The signed-in person's token for the API. `cache` makes the calls of one page render share a single session lookup and signature.
const apiToken = cache(async (): Promise<string | null> => {
  const session = await auth();
  if (!session) return null;
  return encodeJwt({
    token: { sub: session.user.id, email: session.user.email, role: session.user.role, sv: session.user.sessionVersion },
    secret: process.env.AUTH_SECRET!,
    salt: "",
    maxAge: 5 * 60,
  });
});

export async function authedApiFetch(path: string, init: RequestInit = {}) {
  const token = await apiToken();
  // A session that ended while a page or form was open: back to sign-in, as for a banned account below, not an error page.
  if (!token) redirect("/sign-in");
  const res = await apiFetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  // A banned account is refused on every call, so wherever one meets that, the person is sent to the page that says why.
  if (res.status === 403) {
    const code = (await res.clone().json().catch(() => null))?.code;
    if (code === "BANNED") redirect("/suspended");
    // An account its owner asked to delete can only look at that and restore it, so every other page sends it there.
    if (code === "ACCOUNT_CLOSING") redirect("/account/closing");
  }
  return res;
}
