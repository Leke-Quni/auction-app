import type { ReactNode } from "react";

const SIDE = { left: "left-0", right: "right-0", center: "left-1/2 -translate-x-1/2" } as const;

// Hidden until the control is hovered or focused, then shown after a short wait; gone at once when the pointer leaves.
const REVEAL =
  "invisible opacity-0 transition-[opacity,visibility] duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-[400ms] group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-focus-within/tip:delay-[400ms]";

// A speech bubble under a control, with a small arrow pointing up at it (at the middle of the control, wherever the bubble sits, so a
// bubble kept inside the window by `align` still points at the right thing). Shown by hover or keyboard focus after 0.4 seconds, where
// the browser's own `title` waits about a second. Pure CSS, so it works in server and client components. `suppress` leaves it out while
// the control's own menu is open, so it does not sit on the menu. The control keeps its own accessible name; the bubble is extra help
// for people who can see it.
export function Tip({ label, align = "center", suppress = false, children }: { label: string; align?: keyof typeof SIDE; suppress?: boolean; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      {!suppress && (
        <>
          <span
            role="tooltip"
            className={`pointer-events-none absolute top-full z-30 mt-2 w-max max-w-56 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-normal text-ink shadow-md ${REVEAL} ${SIDE[align]}`}
          >
            {label}
          </span>
          <span aria-hidden="true" className={`pointer-events-none absolute left-1/2 top-full z-40 mt-1 size-2 -translate-x-1/2 rotate-45 border-l border-t border-line bg-surface ${REVEAL}`} />
        </>
      )}
    </span>
  );
}
