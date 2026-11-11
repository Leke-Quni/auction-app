import Link from "next/link";
import { redirect } from "next/navigation";
import {
  changePasswordAction,
  startEmailChangeAction,
  updateProfileAction,
  updateUsernameAction,
} from "@/app/actions";
import { PayoutAccountSetting } from "@/app/payout-account-setting";
import { PickupAddressSetting } from "@/app/pickup-address-setting";
import { SettingRow } from "@/app/setting-row";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ payouts?: string }> }) {
  const { payouts } = await searchParams;
  if (!(await auth())) redirect("/sign-in");
  // Coming back from the payment provider, the account is asked about live; if it cannot be, the row is left out.
  const [res, pickupRes, payoutRes] = await Promise.all([
    authedApiFetch("/me"),
    authedApiFetch("/me/pickup-address"),
    authedApiFetch("/me/payout-account").catch(() => null),
  ]);
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /me failed: ${res.status}`);
  const me = await res.json();
  const pickupAddress = pickupRes.ok ? (await pickupRes.json()).pickupAddress : null;
  const payoutStatus = payoutRes?.ok ? (await payoutRes.json()).status : null;
  return (
    <div className="mx-auto max-w-sm space-y-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">Account settings</h1>
        <Link href="/account" className="text-brand underline">
          Back to account
        </Link>
      </div>
      <div className="divide-y divide-line border border-line bg-surface">
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
        <PickupAddressSetting address={pickupAddress} />
        <PayoutAccountSetting status={payoutStatus} returned={payouts} />
      </div>
    </div>
  );
}
