import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, authCookieOptions, signAuthToken } from "@/lib/auth";

export const runtime = "nodejs";

function getEnv(name: string) {
  return process.env[name] ?? "";
}

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

type GoogleUserInfo = {
  email?: string;
  name?: string;
  picture?: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieMap = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const idx = c.indexOf("=");
        if (idx === -1) return [c, ""];
        return [c.slice(0, idx), decodeURIComponent(c.slice(idx + 1))];
      })
  );

  const expectedState = cookieMap["google_oauth_state"] ?? "";
  const next = cookieMap["google_oauth_next"] ?? "/chat";

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = getEnv("GOOGLE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const tokenJson = (await tokenRes.json()) as TokenResponse;
  const accessToken = tokenJson.access_token;
  if (!accessToken) return NextResponse.redirect(new URL("/login", url.origin));

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!userRes.ok) return NextResponse.redirect(new URL("/login", url.origin));
  const userInfo = (await userRes.json()) as GoogleUserInfo;

  const email = typeof userInfo.email === "string" ? userInfo.email.toLowerCase() : "";
  const name = typeof userInfo.name === "string" ? userInfo.name : null;
  const picture = typeof userInfo.picture === "string" ? userInfo.picture : null;
  if (!email || !email.includes("@")) return NextResponse.redirect(new URL("/login", url.origin));

  const randomPasswordHash = await bcrypt.hash(`google-${crypto.randomUUID()}`, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: name ?? undefined,
      image: picture ?? undefined
    },
    create: {
      email,
      name: name ?? undefined,
      image: picture ?? undefined,
      password: randomPasswordHash
    },
    select: { id: true, email: true }
  });

  const jwt = signAuthToken({ sub: user.id, email: user.email });

  const res = NextResponse.redirect(new URL(next, url.origin));
  res.cookies.set(AUTH_COOKIE_NAME, jwt, authCookieOptions());
  // clear state cookies
  res.cookies.set("google_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("google_oauth_next", "", { path: "/", maxAge: 0 });
  return res;
}


