import Link from "next/link";
import { signUpAction } from "../actions";
import { FieldsForm } from "../fields-form";

export default function SignUpPage() {
  return (
    <FieldsForm
      narrow
      action={signUpAction}
      title="Create an account"
      submit="Sign up"
      fields={[
        { name: "firstName", label: "First name", autoComplete: "given-name" },
        { name: "lastName", label: "Last name", autoComplete: "family-name" },
        {
          name: "username",
          label: "Username",
          autoComplete: "username",
          hint: "3-20 characters. Letters, numbers, and underscores are allowed, but none are required. You can change it later.",
        },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 8 characters." },
        { name: "confirmPassword", label: "Confirm password", type: "password", autoComplete: "new-password" },
      ]}
      footer={
        <p className="text-muted">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-brand underline">
            Sign in
          </Link>
        </p>
      }
    />
  );
}
