export const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

// "3 days", "5 hours" or "40 minutes", rounded to the nearest whole unit.
export const timeLeft = (ms: number) => {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (ms >= 48 * 3600_000) return plural(Math.round(ms / (24 * 3600_000)), "day");
  if (ms >= 2 * 3600_000) return plural(Math.round(ms / 3600_000), "hour");
  return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
};
