import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getEnv(name: string) {
  return process.env[name] ?? "";
}

function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/chat";

  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const redirectUri = getEnv("GOOGLE_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  const state = crypto.randomUUID();

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");

  // Persist state + next in httpOnly cookies for CSRF protection and redirect after auth.
  const res = NextResponse.redirect(auth.toString());
  res.cookies.set("google_oauth_state", state, oauthStateCookieOptions());
  res.cookies.set("google_oauth_next", next, oauthStateCookieOptions());
  return res;
}


