import { signUpAction } from "../actions";
import { AuthForm } from "../auth-form";

export default function SignUpPage() {
  return (
    <AuthForm
      action={signUpAction}
      title="Create an account"
      submit="Sign up"
      withName
      footer={{ text: "Already have an account?", href: "/sign-in", label: "Sign in" }}
    />
  );
}
