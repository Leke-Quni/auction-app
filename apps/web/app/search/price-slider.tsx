"use client";

import { useState } from "react";
import { SLIDER_STEPS, eurosToPosition, positionToEuros } from "./price-scale";

const thumb =
  "pointer-events-none absolute inset-x-0 top-0 h-5 w-full appearance-none bg-transparent " +
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 " +
  "[&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-brand " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-brand";

// Two sliders share one track. A thumb left at its end means "no limit", so only a moved thumb adds a filter.
type Props = { maxEuros: number; initialMin?: string; initialMax?: string };

// Starting over whenever the prices in the address change, so removing the price chip puts the handles back at the ends.
export function PriceSlider(props: Props) {
  return <PriceSliderInner key={`${props.initialMin ?? ""}-${props.initialMax ?? ""}`} {...props} />;
}

const toEuros = (text: string) => {
  const euros = Number(text.replace(",", "."));
  return text.trim() !== "" && Number.isFinite(euros) && euros >= 0 ? euros : undefined;
};

const numberBox =
  "w-full border border-[#888] bg-white p-1 text-xs";

// The two boxes hold the prices as typed; dragging a handle fills them in, and typing moves the handles.
// An empty box means no limit, and only a box with something in it is sent with the search.
function PriceSliderInner({ maxEuros, initialMin, initialMax }: Props) {
  const [minText, setMinText] = useState(initialMin ?? "");
  const [maxText, setMaxText] = useState(initialMax ?? "");
  const min = toEuros(minText);
  const max = toEuros(maxText);
  const low = min ? eurosToPosition(min, maxEuros) : 0;
  const high = max !== undefined ? Math.max(eurosToPosition(max, maxEuros), low) : SLIDER_STEPS;

  const dragLow = (position: number) => setMinText(position <= 0 ? "" : String(positionToEuros(Math.min(position, high), maxEuros)));
  const dragHigh = (position: number) =>
    setMaxText(position >= SLIDER_STEPS ? "" : String(positionToEuros(Math.max(position, low), maxEuros)));
  // A minimum typed above the maximum would match nothing, so swap them.
  const tidy = () => {
    if (min !== undefined && max !== undefined && min > max) {
      setMinText(maxText);
      setMaxText(minText);
    }
  };

  return (
    <div>
      <span className="text-[11px] text-muted">Price</span>
      <div className="relative mt-1 h-5">
        <div className="absolute inset-x-0 top-2 h-1 bg-[#ddd]" />
        <div className="absolute top-2 h-1 bg-brand" style={{ left: `${low / 10}%`, width: `${(high - low) / 10}%` }} />
        <input
          type="range"
          aria-label="Minimum price slider"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={low}
          onChange={(e) => dragLow(Number(e.target.value))}
          className={thumb}
          style={{ zIndex: low > SLIDER_STEPS - 50 ? 5 : 3 }}
        />
        <input
          type="range"
          aria-label="Maximum price slider"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={high}
          onChange={(e) => dragHigh(Number(e.target.value))}
          className={thumb}
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="mt-1 flex items-center gap-1">
        <input
          name={minText.trim() ? "minPrice" : undefined}
          aria-label="Minimum price (€)"
          placeholder="Min €"
          inputMode="decimal"
          value={minText}
          onChange={(e) => setMinText(e.target.value)}
          onBlur={tidy}
          className={numberBox}
        />
        <span aria-hidden>–</span>
        <input
          name={maxText.trim() ? "maxPrice" : undefined}
          aria-label="Maximum price (€)"
          placeholder="Max €"
          inputMode="decimal"
          value={maxText}
          onChange={(e) => setMaxText(e.target.value)}
          onBlur={tidy}
          className={numberBox}
        />
      </div>
    </div>
  );
}
