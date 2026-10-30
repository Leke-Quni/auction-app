import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export default function SignInPage() {
  return (
    <AuthForm
      action={signInAction}
      title="Sign in"
      submit="Sign in"
      footer={{ text: "New here?", href: "/sign-up", label: "Create an account" }}
    />
  );
}
