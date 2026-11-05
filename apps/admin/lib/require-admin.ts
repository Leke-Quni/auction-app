import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { adminApiFetch } from "@/lib/api";

export interface AdminUser {
  id: string;
  email: string;
}

// Every admin page asks the API who this is on each request. A demoted admin or a banned account is sent away at once, even
// with a valid session: the session says who signed in, the API says what they may do now.
// `cache` makes the layout and the page of one request share a single answer, so the API is asked once, not once for each.
export const requireAdmin = cache(async (): Promise<AdminUser> => {
  if (!(await auth())) redirect("/sign-in");
  const res = await adminApiFetch("/admin/me").catch(() => null);
  if (!res) throw new Error("The API is not reachable");
  if (res.status === 401 || res.status === 403) redirect("/sign-out?denied=1");
  if (!res.ok) throw new Error(`API /admin/me failed: ${res.status}`);
  return res.json();
});
