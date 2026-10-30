"use client";

import { useEffect, useState } from "react";

// The server does not know the viewer's timezone, so it renders UTC and the browser swaps in local time.
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(`${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
