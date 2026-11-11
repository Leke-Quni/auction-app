// One look for the row of actions on a report: small square icon buttons with a tooltip, red only on hover, and one solid labelled button.
const square = "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-line bg-panel text-muted disabled:opacity-60";

export const iconButton = `${square} hover:bg-page hover:text-ink`;
export const dangerIconButton = `${square} hover:border-danger/50 hover:bg-danger-soft hover:text-danger`;
export const handledButton = "inline-flex h-6 cursor-pointer items-center gap-1 whitespace-nowrap rounded bg-accent px-2 text-xs font-semibold text-on-brand hover:bg-accent-dark";
