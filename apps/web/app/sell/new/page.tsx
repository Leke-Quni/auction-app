import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";
import { ImageUploader } from "../image-uploader";
import { ListingForm } from "../listing-form";

export default async function NewListingPage() {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const res = await apiFetch("/categories");
  if (!res.ok) throw new Error(`API /categories failed: ${res.status}`);
  const categories = await res.json();
  return (
    <div className="mx-auto max-w-xl space-y-2">
      <p className="text-muted">Add the details and photos, then set the price. You publish on the next page.</p>
      <ListingForm categories={categories} photos={<ImageUploader userId={session.user.id} initial={[]} />} />
    </div>
  );
}
