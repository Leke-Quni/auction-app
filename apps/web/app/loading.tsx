const block = "animate-pulse bg-line";

// Shown while a page waits for the API, which can take several seconds when its machine has to wake up.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      <div className={`${block} h-6 w-40`} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-2 border border-line bg-surface p-2">
            <div className={`${block} aspect-square w-full`} />
            <div className={`${block} h-4 w-3/4`} />
            <div className={`${block} h-4 w-1/2`} />
          </div>
        ))}
      </div>
    </div>
  );
}
