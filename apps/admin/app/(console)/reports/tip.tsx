// A tooltip that shows at once on hover or keyboard focus, above its button (the browser's own `title` waits about a second).
export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 w-max max-w-56 rounded bg-ink px-2 py-1 text-xs font-normal text-page opacity-0 shadow transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
