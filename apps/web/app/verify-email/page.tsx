import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const res = token ? await apiFetch("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }) : null;
  const ok = res?.ok ?? false;
  return (
    <div className="mx-auto max-w-sm border border-line bg-white p-4">
      <h1 className="mb-2 text-lg font-bold">{ok ? "Email verified" : "Link invalid or expired"}</h1>
      <p>
        {ok ? "You can sign in now." : "Request a new link by signing up again or contact support."}{" "}
        <Link href="/sign-in" className="text-brand underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
