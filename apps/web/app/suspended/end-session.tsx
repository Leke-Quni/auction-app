"use client";

import { useEffect } from "react";
import { endSessionAction } from "@/app/actions";

// Signs the browser out as soon as the page opens. The page itself does not change, so a person who is mid-sentence reads on.
export function EndSession() {
  useEffect(() => {
    void endSessionAction();
  }, []);
  return null;
}
