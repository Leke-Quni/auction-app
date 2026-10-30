import Link from "next/link";
import { redirect } from "next/navigation";
import {
  changePasswordAction,
  startEmailChangeAction,
  updateProfileAction,
  updateUsernameAction,
} from "@/app/actions";
import { SettingRow } from "@/app/setting-row";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export default async function AccountSettingsPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch("/me");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /me failed: ${res.status}`);
  const me = await res.json();
  return (
    <div className="mx-auto max-w-sm space-y-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">Account settings</h1>
        <Link href="/account" className="text-brand underline">
          Back to account
        </Link>
      </div>
      <div className="divide-y divide-line border border-line bg-white">
        <SettingRow
          label="First name"
          value={me.firstName}
          action={updateProfileAction}
          hidden={{ lastName: me.lastName }}
          fields={[{ name: "firstName", label: "First name", autoComplete: "given-name", defaultValue: me.firstName }]}
        />
        <SettingRow
          label="Last name"
          value={me.lastName}
          action={updateProfileAction}
          hidden={{ firstName: me.firstName }}
          fields={[{ name: "lastName", label: "Last name", autoComplete: "family-name", defaultValue: me.lastName }]}
        />
        <SettingRow
          label="Username"
          value={me.username}
          action={updateUsernameAction}
          fields={[{ name: "username", label: "Username", autoComplete: "username", defaultValue: me.username }]}
        />
        <SettingRow
          label="Email"
          value={me.email}
          action={startEmailChangeAction}
          fields={[
            { name: "newEmail", label: "New email", type: "email", autoComplete: "email" },
            { name: "password", label: "Current password", type: "password", autoComplete: "current-password" },
          ]}
        />
        <SettingRow
          label="Password"
          value="••••••••"
          action={changePasswordAction}
          fields={[
            { name: "currentPassword", label: "Current password", type: "password", autoComplete: "current-password" },
            { name: "newPassword", label: "New password", type: "password", autoComplete: "new-password" },
            { name: "confirmPassword", label: "Confirm new password", type: "password", autoComplete: "new-password" },
          ]}
        />
      </div>
    </div>
  );
}
