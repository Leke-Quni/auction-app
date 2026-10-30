import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";
import { ListingForm } from "../listing-form";

export default async function NewListingPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await apiFetch("/categories");
  if (!res.ok) throw new Error(`API /categories failed: ${res.status}`);
  const categories = await res.json();
  return (
    <div className="mx-auto max-w-xl space-y-2">
      <p className="text-muted">Start with the details. You add photos and publish on the next page.</p>
      <ListingForm categories={categories} />
    </div>
  );
}
