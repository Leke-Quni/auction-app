import Link from "next/link";
import { redirect } from "next/navigation";
import { confirmEmailChangeAction } from "@/app/actions";
import { FieldsForm } from "@/app/fields-form";
import { auth } from "@/auth";

export default async function ConfirmEmailChangePage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  if (!(await auth())) redirect("/sign-in");
  const { pending } = await searchParams;
  if (!pending) redirect("/account/settings");
  return (
    <div className="mx-auto max-w-sm space-y-3">
      <p className="border border-line bg-white p-4">
        We sent a 6-digit code to <b>{pending}</b>. Your email changes once you enter it. The code expires in 10 minutes.
      </p>
      <FieldsForm
        action={confirmEmailChangeAction}
        title="Confirm new email"
        submit="Confirm"
        fields={[
          {
            name: "code",
            label: "6-digit code",
            autoComplete: "one-time-code",
            inputProps: { inputMode: "numeric", pattern: "\\d{6}", maxLength: 6, autoFocus: true },
          },
        ]}
      />
      <Link href="/account/settings" className="text-brand underline">
        Cancel
      </Link>
    </div>
  );
}
