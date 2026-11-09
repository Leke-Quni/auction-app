// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ uploadPresigned: upload }));

import { DISCARD_EVENT } from "../use-unsaved-changes";
import { ImageUploader } from "./image-uploader";

const blobUrl = (name: string) => `https://abc.public.blob.vercel-storage.com/listings/u1/${name}.jpg`;
const file = (name: string, type = "image/jpeg", bytes = 10) => new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  upload.mockReset();
});
afterEach(cleanup);

const setup = (initial: string[] = []) => {
  const { container } = render(<ImageUploader userId="u1" initial={initial} />);
  const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Photo files"), { target: { files } });
  const hidden = () => JSON.parse((container.querySelector('input[name="photos"]') as HTMLInputElement).value) as string[];
  return { choose, hidden };
};

describe("ImageUploader", () => {
  it("shows the photos with the first as the cover", () => {
    setup([blobUrl("a"), blobUrl("b")]);
    expect(screen.getByText("Photos (2/8)")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(within(screen.getAllByRole("listitem")[0]).getByText("Cover")).toBeTruthy();
  });

  it("has a visible Add photos button that opens the file picker", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add photos" }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("disables the button once there are 8 photos", () => {
    setup(Array.from({ length: 8 }, (_, i) => blobUrl(`p${i}`)));
    expect((screen.getByRole("button", { name: "Photo limit reached" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uploads to Blob from the user's folder and only puts the URLs in the hidden field", async () => {
    upload.mockResolvedValueOnce({ url: blobUrl("one") }).mockResolvedValueOnce({ url: blobUrl("two") });
    const { choose, hidden } = setup([blobUrl("a")]);
    choose(file("1.jpg"), file("2.png", "image/png"));

    await waitFor(() => expect(hidden()).toEqual([blobUrl("a"), blobUrl("one"), blobUrl("two")]));
    const [pathname, , options] = upload.mock.calls[0];
    expect(pathname).toMatch(/^listings\/u1\/[0-9a-f-]{36}\.jpg$/);
    expect(options).toMatchObject({ access: "public", handleUploadUrl: "/api/uploads", contentType: "image/jpeg" });
    expect(screen.getByText("Photos (3/8)")).toBeTruthy();
  });

  it("removes and reorders in the hidden field", async () => {
    const { hidden } = setup([blobUrl("a"), blobUrl("b"), blobUrl("c")]);
    expect((screen.getByRole("button", { name: "Move photo 1 earlier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move photo 3 later" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move photo 2 earlier" }));
    await waitFor(() => expect(hidden()).toEqual([blobUrl("b"), blobUrl("a"), blobUrl("c")]));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await waitFor(() => expect(hidden()).toEqual([blobUrl("a"), blobUrl("c")]));
  });

  it("refuses wrong file types and files over 5 MB without uploading them", async () => {
    const { choose, hidden } = setup();
    choose(file("anim.gif", "image/gif"), file("huge.jpg", "image/jpeg", 6 * 1024 * 1024));
    await waitFor(() => expect(screen.getByText(/anim\.gif: only JPG, PNG, and WebP/)).toBeTruthy());
    expect(screen.getByText(/huge\.jpg: larger than 5 MB/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(hidden()).toEqual([]);
  });

  it("uploads only as many photos as fit under the limit of 8", async () => {
    upload.mockImplementation(async (name: string) => ({ url: `https://abc.public.blob.vercel-storage.com/${name}` }));
    const { choose, hidden } = setup(Array.from({ length: 7 }, (_, i) => blobUrl(`p${i}`)));
    choose(file("1.jpg"), file("2.png", "image/png"), file("3.webp", "image/webp"));
    await waitFor(() => expect(hidden()).toHaveLength(8));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/You can add 1 more photo \(up to 8\)/)).toBeTruthy();
  });

  it("shows an error when the upload itself fails and keeps the photos it had", async () => {
    upload.mockRejectedValue(new Error("Network down"));
    const { choose, hidden } = setup([blobUrl("a")]);
    choose(file("a.jpg"));
    await waitFor(() => expect(screen.getByText("Upload failed: Network down")).toBeTruthy());
    expect(hidden()).toEqual([blobUrl("a")]);
  });

  it("deletes only the photos uploaded in this visit when the visitor leaves without saving", async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    upload.mockResolvedValueOnce({ url: blobUrl("fresh") });
    const { choose, hidden } = setup([blobUrl("kept")]);
    choose(file("1.jpg"));
    await waitFor(() => expect(hidden()).toEqual([blobUrl("kept"), blobUrl("fresh")]));

    window.dispatchEvent(new Event(DISCARD_EVENT));
    expect(beacon).toHaveBeenCalledOnce();
    const [path, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(path).toBe("/api/uploads/discard");
    expect(JSON.parse(await body.text())).toEqual({ urls: [blobUrl("fresh")] });

    window.dispatchEvent(new Event(DISCARD_EVENT));
    expect(beacon).toHaveBeenCalledOnce();
  });

  it("deletes nothing when nothing new was uploaded", () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    setup([blobUrl("kept")]);
    window.dispatchEvent(new Event(DISCARD_EVENT));
    expect(beacon).not.toHaveBeenCalled();
  });
});
