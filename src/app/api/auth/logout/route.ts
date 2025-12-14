import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, authCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Clear cookie
  res.cookies.set(AUTH_COOKIE_NAME, "", { ...authCookieOptions(), maxAge: 0 });
  return res;
}


