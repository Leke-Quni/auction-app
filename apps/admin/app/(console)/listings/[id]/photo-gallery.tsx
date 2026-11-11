"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRef, useState } from "react";

// The listing's photos as thumbnails; a click opens the photo large on this page (Esc, the X or a click outside closes it).
export function PhotoGallery({ images }: { images: string[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const step = (by: number) => setIndex((i) => (i + by + images.length) % images.length);
  const open = (i: number) => {
    setIndex(i);
    dialog.current?.showModal();
  };
  const round = "absolute cursor-pointer rounded-full bg-panel/90 p-2 text-ink shadow hover:bg-panel";
  const arrow = `${round} top-1/2 -translate-y-1/2`;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <li key={url}>
            <button type="button" onClick={() => open(i)} aria-label={`Open photo ${i + 1} of ${images.length}`} className="block cursor-zoom-in">
              <img src={url} alt={`Photo ${i + 1}`} className="h-28 w-28 rounded border border-line bg-page object-cover" />
            </button>
            {i === 0 && <span className="text-xs text-muted">Cover</span>}
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        aria-label="Photo viewer"
        className="m-auto bg-transparent p-0 backdrop:bg-black/75"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        onKeyDown={(e) => {
          if (images.length < 2) return;
          if (e.key === "ArrowLeft") step(-1);
          if (e.key === "ArrowRight") step(1);
        }}
      >
        <div className="relative">
          <img src={images[index]} alt={`Photo ${index + 1}`} className="block max-h-[85vh] max-w-[90vw] rounded object-contain" />
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className={`${round} right-2 top-2`}>
            <X size={18} />
          </button>
          {images.length > 1 && (
            <>
              <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className={`${arrow} left-2`}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" onClick={() => step(1)} aria-label="Next photo" className={`${arrow} right-2`}>
                <ChevronRight size={18} />
              </button>
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                {index + 1} / {images.length}
              </p>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
