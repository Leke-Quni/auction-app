import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";
import { ImageUploader } from "../image-uploader";
import { ListingForm } from "../listing-form";

export default async function NewListingPage() {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const res = await apiFetch("/categories");
  if (!res.ok) throw new Error(`API /categories failed: ${res.status}`);
  const categories = await res.json();
  const defaultRes = await authedApiFetch("/me/pickup-address");
  const defaultPickup = defaultRes.ok ? (await defaultRes.json()).pickupAddress : null;
  return (
    <div className="mx-auto max-w-xl space-y-2">
      <p className="text-muted">Add the details and photos, then set the price. You publish on the next page.</p>
      <ListingForm categories={categories} defaultPickup={defaultPickup} photos={<ImageUploader userId={session.user.id} initial={[]} />} />
    </div>
  );
}
