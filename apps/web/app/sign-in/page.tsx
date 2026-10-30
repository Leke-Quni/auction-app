import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <div className="space-y-3">
      {reset && (
        <p className="mx-auto max-w-sm border border-brand bg-white p-3">Password updated. Sign in with your new password.</p>
      )}
      <AuthForm
        action={signInAction}
        title="Sign in"
        submit="Continue"
        forgot
        footer={{ text: "New here?", href: "/sign-up", label: "Create an account" }}
      />
    </div>
  );
}
