import { auth } from "@/auth";
import { encodeJwt } from "@/lib/jwt";

const apiUrl = () => process.env.API_URL ?? "http://localhost:4000";

export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${apiUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

export async function authedApiFetch(path: string, init: RequestInit = {}) {
  const session = await auth();
  if (!session) throw new Error("Not signed in");
  const token = await encodeJwt({
    token: { sub: session.user.id, email: session.user.email, role: session.user.role },
    secret: process.env.AUTH_SECRET!,
    salt: "",
    maxAge: 5 * 60,
  });
  return apiFetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
}
