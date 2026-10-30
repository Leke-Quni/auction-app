import Link from "next/link";
import { resetPasswordAction } from "../actions";
import { FieldsForm } from "../fields-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div className="mx-auto max-w-sm border border-line bg-white p-4">
        <h1 className="mb-2 text-lg font-bold">Link invalid or expired</h1>
        <Link href="/forgot-password" className="text-brand underline">
          Request a new link
        </Link>
      </div>
    );
  }
  // The token is only used when the form is submitted, so link prefetchers and mail scanners can't use it up.
  return (
    <FieldsForm
      narrow
      action={resetPasswordAction}
      title="Choose a new password"
      submit="Set password"
      hidden={{ token }}
      fields={[
        { name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 8 characters." },
        { name: "confirmPassword", label: "Confirm new password", type: "password", autoComplete: "new-password" },
      ]}
    />
  );
}
