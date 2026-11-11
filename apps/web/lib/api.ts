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

export async function authedApiFetch(path: string, init: RequestInit = {}) {
  const session = await auth();
  if (!session) throw new Error("Not signed in");
  const token = await encodeJwt({
    token: { sub: session.user.id, email: session.user.email, role: session.user.role, sv: session.user.sessionVersion },
    secret: process.env.AUTH_SECRET!,
    salt: "",
    maxAge: 5 * 60,
  });
  const res = await apiFetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  // A banned account is refused on every call, so wherever one meets that, the person is sent to the page that says why.
  if (res.status === 403 && (await res.clone().json().catch(() => null))?.code === "BANNED") redirect("/suspended");
  return res;
}
