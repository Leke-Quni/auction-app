import { apiFetch } from "@/lib/api";

// The dearest live price sets how far the price slider reaches.
export async function loadTopPriceCents(): Promise<number | undefined> {
  try {
    const res = await apiFetch("/search?sort=priceDesc&pageSize=1");
    return res.ok ? (await res.json()).items[0]?.startingPriceCents : undefined;
  } catch {
    return undefined;
  }
}
