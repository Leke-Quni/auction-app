import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { encodeJwt } from "@/lib/jwt";

// The session cookie is httpOnly, so the browser cannot hand it to the WebSocket. A signed-in visitor gets a short-lived
// token for the connection instead; a visitor who is not signed in may still watch, so that is an answer, not an error.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ token: null }, { headers: { "Cache-Control": "no-store" } });
  const token = await encodeJwt({
    token: { sub: session.user.id, email: session.user.email, role: session.user.role },
    secret: process.env.AUTH_SECRET!,
    salt: "",
    maxAge: 5 * 60,
  });
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
