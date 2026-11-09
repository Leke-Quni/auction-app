"use server";

import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

// Takes a question or an answer down from the question log. Already gone (404) is harmless: the page just reloads.
export async function removeQuestionPostAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const target = formData.get("target") === "ANSWER" ? "ANSWER" : "QUESTION";
  const version = String(formData.get("version") ?? "") || undefined;
  if (!id) return;
  // `version` is what the page showed; if the post changed since, the API removes nothing and the reloaded page shows the new words.
  const res = await adminApiFetch(`/admin/questions/${encodeURIComponent(id)}/remove`, { method: "POST", body: JSON.stringify({ target, version }) });
  if (!res.ok && res.status !== 404) throw new Error(`Could not remove the ${target.toLowerCase()}: ${res.status}`);
  revalidatePath("/question-log");
}
