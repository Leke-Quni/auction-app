"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// After signing out the page looks almost the same, so say it: a banner for a few seconds, then the marker is removed from the address.
// Signing out moves to the page without leaving the layout, so this component stays mounted: it watches the address for the marker
// (`useSearchParams`) and not only its first load, or the banner would never show.
export function SignedOutNotice() {
  const [show, setShow] = useState(false);
  const marked = useSearchParams().has("signedOut");

  useEffect(() => {
    if (!marked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("signedOut");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setShow(true);
  }, [marked]);

  // A separate effect, so the timer survives the marker being removed from the address (and React running effects twice in development).
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show) return null;
  return (
    <p role="status" className="border-b border-line bg-brand-tint px-4 py-2 text-center font-bold text-brand">
      You have been signed out.
    </p>
  );
}
