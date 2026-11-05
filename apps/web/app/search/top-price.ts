import { apiFetch, rarelyChanging } from "@/lib/api";

// The dearest live price sets how far the price slider reaches. A minute old is fine for that, so it is not asked for on every view.
export async function loadTopPriceCents(): Promise<number | undefined> {
  try {
    const res = await apiFetch("/search?sort=priceDesc&pageSize=1", rarelyChanging(60));
    return res.ok ? (await res.json()).items[0]?.startingPriceCents : undefined;
  } catch {
    return undefined;
  }
}
