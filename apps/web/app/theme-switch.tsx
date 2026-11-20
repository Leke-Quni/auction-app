"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "./use-dismiss";

export const THEME_KEY = "theme";
export type ThemeChoice = "system" | "light" | "dark";

// Runs before the page paints (see the layout), so a chosen theme does not flash the other one first.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const OPTIONS: { choice: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { choice: "system", label: "System", icon: Monitor },
  { choice: "light", label: "Light", icon: Sun },
  { choice: "dark", label: "Dark", icon: Moon },
];

const readChoice = (): ThemeChoice => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
};

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

// Light, Dark, or follow the device: one icon in the header that opens a small menu. The choice is kept in this browser only; "System" is no choice at all.
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  useEffect(() => {
    setChoice(readChoice());
    // Another tab changed it.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY && e.key !== null) return;
      const next = readChoice();
      setChoice(next);
      apply(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice still applies to this visit.
    }
    apply(next);
  };

  const current = OPTIONS.find((o) => o.choice === choice) ?? OPTIONS[0]!;
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Colour theme: ${current.label}`}
        title={`Colour theme: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full hover:bg-chip"
      >
        <CurrentIcon className="size-5" strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Colour theme" className="absolute right-0 z-10 mt-2 w-40 border border-line bg-surface text-ink shadow-md">
          {OPTIONS.map(({ choice: c, label, icon: Icon }) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={choice === c}
              onClick={() => {
                pick(c);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-head"
            >
              <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {choice === c && <Check className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
