import Link from "next/link";
import { forgotPasswordAction } from "../actions";
import { FieldsForm } from "../fields-form";

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-3">
      <FieldsForm
        narrow
        action={forgotPasswordAction}
        title="Forgot your password?"
        submit="Email me a reset link"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      />
      <p className="mx-auto max-w-sm text-muted">
        <Link href="/sign-in" className="text-brand underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
