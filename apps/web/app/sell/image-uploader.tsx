"use client";

import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES } from "@auction/shared";
import { uploadPresigned } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import { DISCARD_EVENT } from "../use-unsaved-changes";

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const small = "cursor-pointer border border-[#888] bg-white px-1.5 text-xs disabled:opacity-40";

// Photos upload to Blob as they are picked but only travel along in the form, as a hidden JSON field, and are attached
// when the form is saved. If the visitor leaves without saving, the photos uploaded meanwhile are deleted again.
export function ImageUploader({ userId, initial }: { userId: string; initial: string[] }) {
  const [urls, setUrls] = useState(initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadedRef = useRef(new Set<string>());
  // Photos deleted because the visitor left. If the page is brought back with the Back button they would show as dead images.
  const discardedRef = useRef(new Set<string>());
  // What the server holds; a save refreshes the page, which brings a new `initial`.
  const savedRef = useRef(new Set(initial));
  savedRef.current = new Set(initial);

  useEffect(() => {
    const discard = () => {
      const urls = [...uploadedRef.current].filter((u) => !savedRef.current.has(u));
      uploadedRef.current.clear();
      if (urls.length === 0) return;
      for (const u of urls) discardedRef.current.add(u);
      const body = new Blob([JSON.stringify({ urls })], { type: "application/json" });
      if (!navigator.sendBeacon?.("/api/uploads/discard", body)) void fetch("/api/uploads/discard", { method: "POST", body, keepalive: true }).catch(() => undefined);
    };
    const restored = (e: PageTransitionEvent) => {
      if (!e.persisted || discardedRef.current.size === 0) return;
      const gone = discardedRef.current;
      setUrls((current) => current.filter((u) => !gone.has(u)));
      discardedRef.current = new Set();
      setError("Photos you had not saved were discarded when you left. Add them again.");
    };
    window.addEventListener(DISCARD_EVENT, discard);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener(DISCARD_EVENT, discard);
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  const addFiles = async (files: File[]) => {
    setError("");
    const room = MAX_IMAGES - urls.length;
    const problems: string[] = [];
    const accepted = files.filter((file) => {
      if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) problems.push(`${file.name}: only JPG, PNG, and WebP photos`);
      else if (file.size > MAX_IMAGE_BYTES) problems.push(`${file.name}: larger than 5 MB`);
      else return true;
      return false;
    });
    if (accepted.length > room) problems.push(`You can add ${room} more photo${room === 1 ? "" : "s"} (up to ${MAX_IMAGES})`);
    const toUpload = accepted.slice(0, Math.max(room, 0));
    if (problems.length > 0) setError(problems.join(". "));
    if (toUpload.length === 0) return;

    setBusy(true);
    const uploaded: string[] = [];
    try {
      for (const [i, file] of toUpload.entries()) {
        setStatus(`Uploading ${i + 1} of ${toUpload.length}…`);
        const blob = await uploadPresigned(`listings/${userId}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`, file, {
          access: "public",
          handleUploadUrl: "/api/uploads",
          contentType: file.type,
        });
        uploaded.push(blob.url);
        uploadedRef.current.add(blob.url);
      }
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    }
    if (uploaded.length > 0) setUrls([...urls, ...uploaded]);
    setStatus("");
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const change = (next: string[]) => {
    setError("");
    setUrls(next);
  };

  const move = (from: number, to: number) => {
    const next = [...urls];
    [next[from], next[to]] = [next[to], next[from]];
    return change(next);
  };

  return (
    <div className="space-y-2 border border-line bg-white p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">
          Photos ({urls.length}/{MAX_IMAGES})
        </h2>
        <span className="text-xs text-muted" role="status">
          {status}
        </span>
      </div>
      <p className="text-xs text-muted">
        JPG, PNG, or WebP, up to 5 MB each. The first photo is the cover.
        {" Photos upload as you pick them and are kept when you press Save; leave without saving and they are discarded."}
      </p>
      <input type="hidden" name="photos" value={JSON.stringify(urls)} />

      {urls.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {urls.map((url, i) => (
            <li key={url} className="space-y-1">
              <div className="relative">
                <img src={url} alt={`Photo ${i + 1}`} className="aspect-square w-full bg-[#ddd] object-cover" />
                {i === 0 && <span className="absolute left-0 top-0 bg-brand px-1 text-xs text-white">Cover</span>}
              </div>
              <div className="flex gap-1">
                <button type="button" aria-label={`Move photo ${i + 1} earlier`} disabled={busy || i === 0} onClick={() => move(i, i - 1)} className={small}>
                  ◀
                </button>
                <button type="button" aria-label={`Move photo ${i + 1} later`} disabled={busy || i === urls.length - 1} onClick={() => move(i, i + 1)} className={small}>
                  ▶
                </button>
                <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={busy} onClick={() => change(urls.filter((_, j) => j !== i))} className={small}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={IMAGE_TYPES.join(",")}
        aria-label="Photo files"
        tabIndex={-1}
        disabled={busy || urls.length >= MAX_IMAGES}
        onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        className="sr-only"
      />
      <button
        type="button"
        disabled={busy || urls.length >= MAX_IMAGES}
        onClick={() => fileInput.current?.click()}
        className="cursor-pointer bg-brand px-4 py-2 font-bold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Working…" : urls.length >= MAX_IMAGES ? "Photo limit reached" : "+ Add photos"}
      </button>
      {error && <p className="text-urgent">{error}</p>}
    </div>
  );
}
