"use client";

import { useEffect, useState } from "react";

export function formatRemaining(ms: number) {
  if (ms <= 0) return "Ended";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function timeColor(remainingMs: number, totalMs: number) {
  const left = totalMs > 0 ? remainingMs / totalMs : 0;
  if (left > 0.5) return "text-time-ok";
  if (left > 0.1) return "text-time-warn";
  return "text-urgent";
}

// The server cannot know the viewer's clock, so it renders a dash and the browser starts the count.
export function Countdown({ iso, startIso }: { iso: string; startIso: string }) {
  const [text, setText] = useState("—");
  const [color, setColor] = useState("");
  useEffect(() => {
    const end = new Date(iso).getTime();
    const total = end - new Date(startIso).getTime();
    const tick = () => {
      const remaining = end - Date.now();
      setText(formatRemaining(remaining));
      setColor(timeColor(remaining, total));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [iso, startIso]);
  return (
    <time dateTime={iso} className={`whitespace-nowrap font-bold ${color}`}>
      {text}
    </time>
  );
}
