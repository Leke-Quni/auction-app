"use client";

import { useEffect, useState } from "react";

type Image = { id: string; url: string };

export function Gallery({ images, alt }: { images: Image[]; alt: string }) {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  if (images.length === 0) {
    return <div className="flex aspect-square items-center justify-center bg-sunken text-muted">No photos</div>;
  }
  return (
    <div>
      <button type="button" aria-label="Enlarge photo" onClick={() => setOpen(true)} className="block w-full cursor-zoom-in">
        <img src={images[selected].url} alt={alt} fetchPriority="high" className="aspect-square w-full rounded-card bg-sunken object-cover" />
      </button>
      {images.length > 1 && (
        <div className="mt-1 grid grid-cols-4 gap-1">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              aria-label={`Show photo ${i + 1}`}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
              className={`cursor-pointer border-2 ${i === selected ? "border-brand" : "border-transparent"}`}
            >
              <img src={image.url} alt="" loading="lazy" className="aspect-square w-full rounded-control object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && <Lightbox images={images} alt={alt} index={selected} onIndex={setSelected} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Lightbox({ images, alt, index, onIndex, onClose }: { images: Image[]; alt: string; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const count = images.length;
  const go = (step: number) => onIndex((index + step + count) % count);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (count > 1 && event.key === "ArrowLeft") onIndex((index - 1 + count) % count);
      else if (count > 1 && event.key === "ArrowRight") onIndex((index + 1) % count);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, count, onIndex, onClose]);

  const control = "absolute cursor-pointer bg-black/60 px-3 py-2 text-xl font-bold text-white hover:bg-black/80";
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <img
        src={images[index].url}
        alt={`${alt}, photo ${index + 1} of ${count}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full object-contain"
      />
      <button type="button" aria-label="Close" onClick={onClose} className={`${control} right-3 top-3`}>
        ✕
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            className={`${control} left-3 top-1/2 -translate-y-1/2`}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            className={`${control} right-3 top-1/2 -translate-y-1/2`}
          >
            ›
          </button>
          <p className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-1 text-sm text-white">
            {index + 1} / {count}
          </p>
        </>
      )}
    </div>
  );
}
