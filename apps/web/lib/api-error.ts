/** Pulls a user-facing message out of an API error response (validation errors, or Nest's default shape). */
export async function apiErrorMessage(res: Response, fallback = "Something went wrong. Try again.") {
  const body = await res.json().catch(() => null);
  if (!body) return fallback;
  const fieldError = body.fieldErrors ? Object.values(body.fieldErrors).flat()[0] : undefined;
  if (typeof fieldError === "string") return fieldError;
  if (typeof body.formErrors?.[0] === "string") return body.formErrors[0];
  if (typeof body.message === "string") return body.message;
  return fallback;
}
