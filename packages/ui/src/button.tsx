import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

// Unstyled-by-default primitive: each app supplies its look through theme tokens (bg-brand, text-on-brand).
export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn("cursor-pointer bg-brand px-3 py-2 font-bold text-on-brand disabled:opacity-60", className)}
      {...props}
    />
  );
}
