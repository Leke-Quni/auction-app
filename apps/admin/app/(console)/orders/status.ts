export type Status = "AWAITING_PAYMENT" | "PAID" | "EXPIRED" | "CANCELLED";

export const STATUS_LABEL: Record<Status, string> = { AWAITING_PAYMENT: "Awaiting payment", PAID: "Paid", EXPIRED: "Expired", CANCELLED: "Cancelled" };
export const STATUS_PILL: Record<Status, string> = { AWAITING_PAYMENT: "bg-warn-soft text-warn", PAID: "bg-ok-soft text-ok", EXPIRED: "bg-danger-soft text-danger", CANCELLED: "bg-page text-muted" };
