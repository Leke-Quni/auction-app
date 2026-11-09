// Runs Auth.js on every page request, which re-signs the session and pushes its expiry forward (see lib/session-lifetime.ts):
// the session is an idle timeout, not a fixed length of time since sign-in.
export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
