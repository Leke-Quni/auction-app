"use client";

import { useState } from "react";

export function Gallery({ images, alt }: { images: { id: string; url: string }[]; alt: string }) {
  const [selected, setSelected] = useState(0);
  if (images.length === 0) {
    return <div className="flex aspect-square items-center justify-center bg-[#ddd] text-muted">No photos</div>;
  }
  return (
    <div>
      <img src={images[selected].url} alt={alt} className="aspect-square w-full bg-[#ddd] object-cover" />
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
              <img src={image.url} alt="" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
