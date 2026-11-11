import type { PayoutAccountStatus } from "@auction/shared";
import { PayButton } from "./orders/pay-button";
import { startPayoutOnboardingAction } from "./orders/actions";

const TEXT: Record<PayoutAccountStatus, { value: string; button: string }> = {
  NOT_STARTED: { value: "Not set up", button: "Set up payouts" },
  PENDING: { value: "Setup not finished", button: "Finish setup" },
  READY: { value: "Ready to be paid", button: "Update details" },
};

// Where the seller's share of each sale is paid. Set up with the payment provider; nothing is stored here but the account id.
export function PayoutAccountSetting({ status, returned }: { status: PayoutAccountStatus | null; returned?: string }) {
  if (!status) return null;
  const text = TEXT[status];
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-muted">Payouts</span>
        <span className="min-w-0 flex-1">{text.value}</span>
      </div>
      {returned === "refresh" && <p className="text-xs text-urgent">That setup link expired. Open a new one below.</p>}
      {returned === "demo" && status === "READY" && (
        <p role="status" className="text-xs text-brand">
          Payouts are set up. This is a demo, so the payout account is simulated and no payment provider page opens.
        </p>
      )}
      {returned === "1" && status === "READY" && <p role="status" className="text-xs text-brand">Payouts are set up.</p>}
      {returned === "1" && status === "PENDING" && <p role="status" className="text-xs text-muted">Setup is not finished yet. Use Finish setup to continue.</p>}
      <p className="text-xs text-muted">Your share is paid 3 days after the buyer receives the item.</p>
      <PayButton action={startPayoutOnboardingAction} label={text.button} orderId="" />
    </div>
  );
}
