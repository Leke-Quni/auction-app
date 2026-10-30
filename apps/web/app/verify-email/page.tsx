import Link from "next/link";
import { verifyEmailAction } from "../actions";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token, status } = await searchParams;

  // Verifying needs a POST from the button, so link prefetchers and mail scanners can't use up the token.
  if (token && !status) {
    return (
      <form action={verifyEmailAction} className="mx-auto max-w-sm space-y-3 border border-line bg-white p-4">
        <h1 className="text-lg font-bold">Confirm your email</h1>
        <input type="hidden" name="token" value={token} />
        <button className="w-full cursor-pointer bg-brand p-2 font-bold text-white hover:bg-brand-dark">
          Confirm email
        </button>
      </form>
    );
  }

  const ok = status === "ok";
  return (
    <div className="mx-auto max-w-sm border border-line bg-white p-4">
      <h1 className="mb-2 text-lg font-bold">{ok ? "Email verified" : "Link invalid or expired"}</h1>
      <p>
        {ok ? "You can sign in now." : "Sign up again with the same email to get a new link."}{" "}
        <Link href={ok ? "/sign-in" : "/sign-up"} className="text-brand underline">
          {ok ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}
