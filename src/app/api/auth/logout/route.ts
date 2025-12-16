import { NextResponse } from "next/server";

import { authCookieOptions, getAuthCookieName } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Clear cookie
  res.cookies.set(getAuthCookieName(), "", { ...authCookieOptions(), maxAge: 0 });
  return res;
}


