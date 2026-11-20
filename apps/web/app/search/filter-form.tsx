"use client";

import Form from "next/form";
import Link from "next/link";
import { createContext, Fragment, useContext, useState, type ComponentProps, type ReactNode } from "react";

const ResetFilters = createContext<() => void>(() => {});

// The sidebar's filter form. Its boxes are uncontrolled, so they keep whatever was ticked or typed and not yet applied; "Clear" starts
// the form's contents over (a new `key`), so those ticks and the price boxes go too, even when the address does not change.
export function FilterForm({ children, ...props }: ComponentProps<typeof Form>) {
  const [round, setRound] = useState(0);
  return (
    <ResetFilters.Provider value={() => setRound((n) => n + 1)}>
      <Form {...props}>
        <Fragment key={round}>{children}</Fragment>
      </Form>
    </ResetFilters.Provider>
  );
}

// Goes to the plain search page and clears the form around it.
export function ClearFiltersLink({ className, children }: { className?: string; children: ReactNode }) {
  const reset = useContext(ResetFilters);
  return (
    <Link href="/search" onClick={reset} className={className}>
      {children}
    </Link>
  );
}
