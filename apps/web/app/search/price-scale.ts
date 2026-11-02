export const SLIDER_STEPS = 1000;
const MIN_SCALE_EUROS = 100;

// The top of the slider: the dearest live price, rounded up to one significant digit (1234 -> 2000), at least 100.
export function sliderMaxEuros(topPriceCents: number | undefined) {
  const euros = Math.ceil((topPriceCents ?? 0) / 100);
  if (euros <= MIN_SCALE_EUROS) return MIN_SCALE_EUROS;
  const unit = 10 ** Math.floor(Math.log10(euros));
  return Math.ceil(euros / unit) * unit;
}

// Prices bunch up near the bottom, so the slider is cubic: the first half of the track covers the cheap listings.
const roundNice = (euros: number) => {
  const step = euros < 50 ? 1 : euros < 200 ? 5 : euros < 1000 ? 10 : euros < 5000 ? 50 : euros < 20000 ? 100 : 500;
  return Math.round(euros / step) * step;
};

export function positionToEuros(position: number, maxEuros: number) {
  if (position >= SLIDER_STEPS) return maxEuros;
  return Math.min(maxEuros, roundNice(maxEuros * (position / SLIDER_STEPS) ** 3));
}

export function eurosToPosition(euros: number, maxEuros: number) {
  if (!Number.isFinite(euros) || euros <= 0) return 0;
  return Math.min(SLIDER_STEPS, Math.round(SLIDER_STEPS * Math.cbrt(euros / maxEuros)));
}
