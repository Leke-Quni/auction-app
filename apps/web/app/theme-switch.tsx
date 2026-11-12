"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

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

// Light, Dark, or follow the device, in the header. The choice is kept in this browser only; "System" is no choice at all.
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
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

  // On the narrowest phones the three buttons would push the header onto another row, so one button stands in for them and
  // steps to the next choice each time it is pressed.
  const current = OPTIONS.find((o) => o.choice === choice) ?? OPTIONS[0]!;
  const next = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length]!;
  const CurrentIcon = current.icon;

  return (
    <>
      <button
        type="button"
        aria-label={`Colour theme: ${current.label}. Switch to ${next.label}`}
        title={`Colour theme: ${current.label}`}
        onClick={() => pick(next.choice)}
        className="inline-flex cursor-pointer items-center rounded-[var(--radius-card)] border border-brand bg-brand px-1.5 py-1 text-on-brand min-[400px]:hidden"
      >
        <CurrentIcon size={14} aria-hidden="true" />
      </button>
      <div role="group" aria-label="Colour theme" className="inline-flex gap-1 max-[399px]:hidden">
        {OPTIONS.map(({ choice: c, label, icon: Icon }) => (
          <button
            key={c}
            type="button"
            aria-pressed={choice === c}
            aria-label={label}
            title={label}
            onClick={() => pick(c)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-card)] border px-2.5 py-1 text-xs max-sm:px-1 ${choice === c ? "border-brand bg-brand font-bold text-on-brand" : "border-line bg-surface text-brand hover:bg-head"}`}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="max-sm:sr-only">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
