"use client";

import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES } from "@auction/shared";
import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { saveImagesAction } from "./actions";

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const small = "cursor-pointer border border-[#888] bg-white px-1.5 text-xs disabled:opacity-40";

export interface PhotoState {
  count: number;
}

export function ImageUploader({
  listingId,
  userId,
  initial,
  onCountChange,
}: {
  listingId: string;
  userId: string;
  initial: string[];
  onCountChange?: (count: number) => void;
}) {
  const [urls, setUrls] = useState(initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Saves the whole ordered list; on failure the screen goes back to what was last saved.
  const persist = async (next: string[], previous: string[]) => {
    setStatus("Saving…");
    const result = await saveImagesAction(listingId, next);
    if (result.error) {
      setUrls(previous);
      onCountChange?.(previous.length);
      setError(result.error);
      setStatus("");
      return false;
    }
    setUrls(next);
    onCountChange?.(next.length);
    setStatus("Saved.");
    return true;
  };

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
        const blob = await upload(`listings/${userId}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`, file, {
          access: "public",
          handleUploadUrl: "/api/uploads",
          contentType: file.type,
        });
        uploaded.push(blob.url);
      }
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    }
    if (uploaded.length > 0) await persist([...urls, ...uploaded], urls);
    else setStatus("");
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const change = async (next: string[]) => {
    setError("");
    setBusy(true);
    await persist(next, urls);
    setBusy(false);
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
      <p className="text-xs text-muted">JPG, PNG, or WebP, up to 5 MB each. The first photo is the cover.</p>

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
        aria-label="Add photos"
        disabled={busy || urls.length >= MAX_IMAGES}
        onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        className="block w-full text-sm"
      />
      {error && <p className="text-urgent">{error}</p>}
    </div>
  );
}
