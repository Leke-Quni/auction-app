// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upload, saveImagesAction } = vi.hoisted(() => ({ upload: vi.fn(), saveImagesAction: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ uploadPresigned: upload }));
vi.mock("./actions", () => ({ saveImagesAction }));

import { ImageUploader } from "./image-uploader";

const blobUrl = (name: string) => `https://abc.public.blob.vercel-storage.com/listings/u1/${name}.jpg`;
const file = (name: string, type = "image/jpeg", bytes = 10) => new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  upload.mockReset();
  saveImagesAction.mockReset();
  saveImagesAction.mockResolvedValue({});
});
afterEach(cleanup);

const setup = (initial: string[] = [], onCountChange = vi.fn()) => {
  render(<ImageUploader listingId="L1" userId="u1" initial={initial} onCountChange={onCountChange} />);
  const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Photo files"), { target: { files } });
  return { choose, onCountChange };
};

describe("ImageUploader", () => {
  it("shows the photos with the first as the cover", () => {
    setup([blobUrl("a"), blobUrl("b")]);
    expect(screen.getByText("Photos (2/8)")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getAllByText("Cover")).toHaveLength(1);
    expect(within(screen.getAllByRole("listitem")[0]).getByText("Cover")).toBeTruthy();
  });

  it("has a visible Add photos button that opens the file picker", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    setup();
    const button = screen.getByRole("button", { name: "+ Add photos" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("disables the button once there are 8 photos", () => {
    setup(Array.from({ length: 8 }, (_, i) => blobUrl(`p${i}`)));
    const button = screen.getByRole("button", { name: "Photo limit reached" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("uploads straight to Blob from the user's folder, then saves the new list", async () => {
    upload.mockResolvedValue({ url: blobUrl("new") });
    const { choose, onCountChange } = setup([blobUrl("a")]);
    choose(file("holiday.jpg"));

    await waitFor(() => expect(saveImagesAction).toHaveBeenCalledWith("L1", [blobUrl("a"), blobUrl("new")]));
    const [pathname, , options] = upload.mock.calls[0];
    expect(pathname).toMatch(/^listings\/u1\/[0-9a-f-]{36}\.jpg$/);
    expect(options).toMatchObject({ access: "public", handleUploadUrl: "/api/uploads", contentType: "image/jpeg" });
    await waitFor(() => expect(screen.getByText("Saved.")).toBeTruthy());
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(screen.getByText("Photos (2/8)")).toBeTruthy();
  });

  it("refuses wrong file types and files over 5 MB without uploading them", async () => {
    const { choose } = setup();
    choose(file("anim.gif", "image/gif"), file("huge.jpg", "image/jpeg", 6 * 1024 * 1024));
    await waitFor(() => expect(screen.getByText(/anim\.gif: only JPG, PNG, and WebP/)).toBeTruthy());
    expect(screen.getByText(/huge\.jpg: larger than 5 MB/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(saveImagesAction).not.toHaveBeenCalled();
  });

  it("uploads only as many photos as fit under the limit of 8", async () => {
    upload.mockImplementation(async (name: string) => ({ url: `https://abc.public.blob.vercel-storage.com/${name}` }));
    const initial = Array.from({ length: 7 }, (_, i) => blobUrl(`p${i}`));
    const { choose } = setup(initial);
    choose(file("1.jpg"), file("2.png", "image/png"), file("3.webp", "image/webp"));

    await waitFor(() => expect(saveImagesAction).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(saveImagesAction.mock.calls[0][1]).toHaveLength(8);
    expect(screen.getByText(/You can add 1 more photo \(up to 8\)/)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Photo files") as HTMLInputElement).disabled).toBe(true));
  });

  it("removes a photo and saves the rest", async () => {
    setup([blobUrl("a"), blobUrl("b"), blobUrl("c")]);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    await waitFor(() => expect(saveImagesAction).toHaveBeenCalledWith("L1", [blobUrl("a"), blobUrl("c")]));
    await waitFor(() => expect(screen.getByText("Photos (2/8)")).toBeTruthy());
  });

  it("reorders photos, and cannot move the first earlier or the last later", async () => {
    setup([blobUrl("a"), blobUrl("b"), blobUrl("c")]);
    expect((screen.getByRole("button", { name: "Move photo 1 earlier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move photo 3 later" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Move photo 2 earlier" }));
    await waitFor(() => expect(saveImagesAction).toHaveBeenCalledWith("L1", [blobUrl("b"), blobUrl("a"), blobUrl("c")]));
    await waitFor(() => expect(within(screen.getAllByRole("listitem")[0]).getByText("Cover")).toBeTruthy());
    expect((screen.getAllByRole("img")[0] as HTMLImageElement).src).toBe(blobUrl("b"));
  });

  it("goes back to the last saved photos and shows the error when saving fails", async () => {
    saveImagesAction.mockResolvedValue({ error: "Photos must be uploaded through the site" });
    const { onCountChange } = setup([blobUrl("a"), blobUrl("b")]);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await waitFor(() => expect(screen.getByText("Photos must be uploaded through the site")).toBeTruthy());
    expect(screen.getByText("Photos (2/8)")).toBeTruthy();
    expect(onCountChange).toHaveBeenLastCalledWith(2);
  });

  it("shows an error and saves nothing when the upload itself fails", async () => {
    upload.mockRejectedValue(new Error("Network down"));
    const { choose } = setup([blobUrl("a")]);
    choose(file("a.jpg"));
    await waitFor(() => expect(screen.getByText("Upload failed: Network down")).toBeTruthy());
    expect(saveImagesAction).not.toHaveBeenCalled();
    expect(screen.getByText("Photos (1/8)")).toBeTruthy();
  });

  describe("on the new-listing form, before a listing exists", () => {
    const setupLocal = (initial: string[] = []) => {
      const onCountChange = vi.fn();
      const { container } = render(<ImageUploader userId="u1" initial={initial} onCountChange={onCountChange} />);
      const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Photo files"), { target: { files } });
      const hidden = () => JSON.parse((container.querySelector('input[name="photos"]') as HTMLInputElement).value) as string[];
      return { choose, hidden, onCountChange };
    };

    it("starts with an empty hidden photos field and explains when photos are saved", () => {
      const { hidden } = setupLocal();
      expect(hidden()).toEqual([]);
      expect(screen.getByText(/saved when you create the draft/)).toBeTruthy();
    });

    it("uploads to Blob right away but saves nothing to the server; the URLs go in the hidden field", async () => {
      upload.mockResolvedValueOnce({ url: blobUrl("one") }).mockResolvedValueOnce({ url: blobUrl("two") });
      const { choose, hidden, onCountChange } = setupLocal();
      choose(file("1.jpg"), file("2.png", "image/png"));

      await waitFor(() => expect(hidden()).toEqual([blobUrl("one"), blobUrl("two")]));
      expect(upload).toHaveBeenCalledTimes(2);
      expect(saveImagesAction).not.toHaveBeenCalled();
      expect(onCountChange).toHaveBeenLastCalledWith(2);
      expect(screen.getByText("Photos (2/8)")).toBeTruthy();
    });

    it("removes and reorders in the hidden field without calling the server", async () => {
      const { hidden } = setupLocal([blobUrl("a"), blobUrl("b"), blobUrl("c")]);
      fireEvent.click(screen.getByRole("button", { name: "Move photo 2 earlier" }));
      await waitFor(() => expect(hidden()).toEqual([blobUrl("b"), blobUrl("a"), blobUrl("c")]));
      fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      await waitFor(() => expect(hidden()).toEqual([blobUrl("a"), blobUrl("c")]));
      expect(saveImagesAction).not.toHaveBeenCalled();
    });

    it("still refuses wrong types and oversize files", async () => {
      const { choose, hidden } = setupLocal();
      choose(file("anim.gif", "image/gif"));
      await waitFor(() => expect(screen.getByText(/only JPG, PNG, and WebP/)).toBeTruthy());
      expect(upload).not.toHaveBeenCalled();
      expect(hidden()).toEqual([]);
    });
  });
});
