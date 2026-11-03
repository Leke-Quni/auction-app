"use client";

import { useEffect, useState } from "react";

const utcText = (iso: string, timeFirst: boolean) => {
  const [date, time] = new Date(iso).toISOString().slice(0, 16).split("T");
  return timeFirst ? `${time} UTC, ${date}` : `${date} ${time} UTC`;
};

const localText = (iso: string, timeFirst: boolean) => {
  const date = new Date(iso);
  if (!timeFirst) return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${date.toLocaleTimeString(undefined, { timeStyle: "short" })}, ${date.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
};

// The server does not know the viewer's timezone, so it renders UTC and the browser swaps in local time.
export function LocalTime({ iso, timeFirst = false }: { iso: string; timeFirst?: boolean }) {
  const [text, setText] = useState(utcText(iso, timeFirst));
  useEffect(() => {
    setText(localText(iso, timeFirst));
  }, [iso, timeFirst]);
  return <time dateTime={iso}>{text}</time>;
}
