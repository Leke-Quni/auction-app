// A row of five stars, filled (★) up to the (possibly fractional) rating and empty (☆) after it, with the rating in words for
// screen readers.
export function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span role="img" aria-label={`${value} out of 5 stars`} className="whitespace-nowrap text-star">
      {"★".repeat(filled)}
      <span className="text-faint">{"☆".repeat(5 - filled)}</span>
    </span>
  );
}
