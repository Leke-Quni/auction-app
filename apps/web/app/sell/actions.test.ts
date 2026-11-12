import { beforeEach, describe, expect, it, vi } from "vitest";

const { authedApiFetch, revalidatePath, redirect, auth } = vi.hoisted(() => ({
  authedApiFetch: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
  auth: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));
vi.mock("@/lib/blob", () => ({ deleteOwnBlobs: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import { saveListingAction } from "./actions";

const url = "https://abc.public.blob.vercel-storage.com/listings/u1/a.jpg";
const reply = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(() => {
  authedApiFetch.mockReset().mockImplementation(async () => reply());
  revalidatePath.mockReset();
  redirect.mockClear();
  auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
});

describe("saveListingAction", () => {
  it("tells the form to take a published listing's seller back to the listing page after saving the description and photos", async () => {
    const result = await saveListingAction({}, form({ listingId: "L1", description: "A long enough description", photos: JSON.stringify([url]) }));
    expect(result).toEqual({ ok: "Saved.", redirectTo: "/listings/L1" });
    expect(revalidatePath).toHaveBeenCalledWith("/listings/L1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("keeps a draft's seller on the edit page, since the draft still has to be published", async () => {
    const result = await saveListingAction(
      {},
      form({
        listingId: "L1",
        title: "Vintage wristwatch",
        description: "A long enough description",
        categoryId: "c1",
        condition: "GOOD",
        startingPrice: "25",
        reservePrice: "",
        durationDays: "7",
        photos: JSON.stringify([url]),
      }),
    );
    expect(result).toEqual({ ok: "Saved." });
    expect(redirect).not.toHaveBeenCalled();
  });
});
