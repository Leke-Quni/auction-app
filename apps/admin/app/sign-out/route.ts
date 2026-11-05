import { signOut } from "@/auth";

// Ends the session and shows the sign-in page, with a note when the API said this account may not use the admin app.
export async function GET(request: Request) {
  const denied = new URL(request.url).searchParams.get("denied");
  await signOut({ redirectTo: denied ? "/sign-in?denied=1" : "/sign-in" });
}
