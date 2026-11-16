"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useDismiss } from "./use-dismiss";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: readonly SelectOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  // Shown while nothing is chosen; the empty value is then a choice that cannot be picked from the list.
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  // How the closed box looks, like the className of a text field.
  className?: string;
  // Passed to the form control that carries the value (for example `data-publish-required`).
  controlProps?: Partial<Record<`data-${string}`, string>>;
}

// A drop-down list drawn with the app's own tokens instead of the browser's. A native <select> stays inside it, hidden, as the form's
// control: it carries the name, the value and `required`, so forms, validation and the browser's autofill work as with any select.
// The visible part is a combobox button that opens a listbox; both follow the keyboard pattern of a native select
// (arrows, Home/End, typing a letter, Enter or Space to pick, Escape to close).
export function Select({ options, name, value, defaultValue = "", onChange, placeholder = "Choose…", required, disabled, id, className = "", controlProps, ...rest }: SelectProps) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  useDismiss(root, open, () => setOpen(false));

  const selected = options.findIndex((o) => o.value === current);
  const shown = selected >= 0 ? options[selected]!.label : placeholder;
  const enabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
    return -1;
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    // The choice goes through the hidden select as a real change, so the form around it hears it (its input and change listeners, the
    // unsaved-changes guard) exactly as with a native select, and anything that submits on change sends the new value.
    const el = native.current;
    if (el) {
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
    button.current?.focus();
  };
  const show = (index: number) => {
    setOpen(true);
    setActive(index);
  };
  const move = (index: number) => {
    if (index < 0) return;
    setActive(index);
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const from = open ? active : selected;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) show(selected >= 0 ? selected : enabled(0, 1));
        else move(enabled(active + 1, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) show(selected >= 0 ? selected : enabled(options.length - 1, -1));
        else move(enabled(active - 1, -1));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          move(enabled(0, 1));
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          move(enabled(options.length - 1, -1));
        }
        break;
      case "Enter":
      case " ":
        if (e.key === " " && typed.current.text) break; // a space inside a word being typed
        e.preventDefault();
        if (open) choose(active);
        else show(selected);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation(); // the dialog around it should not also close
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) break;
        // Typing letters jumps to the next option that starts with them; a pause of a second starts a new word.
        const now = Date.now();
        const text = (now - typed.current.at > 1000 ? "" : typed.current.text) + e.key.toLowerCase();
        typed.current = { text, at: now };
        const start = text.length === 1 ? from + 1 : from;
        const order = [...options.keys()];
        const hit = [...order.slice(Math.max(start, 0)), ...order.slice(0, Math.max(start, 0))].find(
          (i) => !options[i]!.disabled && options[i]!.label.toLowerCase().startsWith(text),
        );
        if (hit !== undefined) {
          if (open) move(hit);
          else show(hit);
        }
      }
    }
  };

  return (
    <div ref={root} className="relative [&:has(select[aria-invalid=true])>button]:border-urgent [&:has(select[aria-invalid=true])>button]:outline [&:has(select[aria-invalid=true])>button]:outline-2 [&:has(select[aria-invalid=true])>button]:outline-urgent">
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-label={rest["aria-label"]}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show(selected))}
        onKeyDown={onKeyDown}
        className={`${className} flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected < 0 ? "text-placeholder" : ""}`}>{shown}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {/* A click inside the list is kept from reaching the field's <label>, which would press the box again and reopen the list. */}
      {open && (
        <ul id={listId} role="listbox" tabIndex={-1} onClick={(e) => e.preventDefault()} className="absolute left-0 z-20 mt-1 max-h-60 min-w-full overflow-y-auto border border-line bg-surface py-1 text-ink shadow-md">
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              aria-disabled={o.disabled || undefined}
              onMouseEnter={() => !o.disabled && setActive(i)}
              // Not on mouse down: the box keeps focus, so the keyboard keeps working after a click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              className={`flex items-start gap-2 px-3 py-1.5 ${o.disabled ? "cursor-not-allowed text-faint" : "cursor-pointer"} ${i === active ? "bg-head" : ""} ${i === selected ? "font-bold" : ""}`}
            >
              <span className="min-w-0 flex-1">{o.label}</span>
              {i === selected && <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
      <select
        ref={native}
        name={name}
        value={current}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        {...controlProps}
        onChange={(e) => {
          setInner(e.target.value);
          onChange?.(e.target.value);
        }}
        // Anything that moves focus here (the form pointing at a field it refused, or the browser's own bubble) lands on the visible box.
        onFocus={() => button.current?.focus()}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
