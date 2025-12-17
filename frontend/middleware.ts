import { NextRequest, NextResponse } from "next/server";

function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "auth_token";
}

function isAuthRoute(pathname: string) {
  return pathname.startsWith("/api/auth/");
}

function applyCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  // If the request has an Origin header, echo it back so cookies/credentials can be used.
  // Using "*" with credentials is blocked by browsers.
  res.headers.set("Access-Control-Allow-Origin", origin ?? "*");
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    req.headers.get("access-control-request-headers") ?? "Content-Type, Authorization"
  );
  res.headers.set("Vary", "Origin, Access-Control-Request-Headers");
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Socket.IO requests are proxied to the standalone socket server via rewrites.
  // In Next dev/proxy mode, the downstream may not receive the original Cookie header reliably,
  // so we forward it explicitly for the socket server to read.
  if (pathname === "/socket.io" || pathname.startsWith("/socket.io/")) {
    const headers = new Headers(req.headers);
    const cookie = req.headers.get("cookie");
    if (cookie) headers.set("x-forwarded-cookie", cookie);
    // Do not apply auth redirects here; the socket server enforces auth itself.
    return NextResponse.next({ request: { headers } });
  }

  // CORS for API routes
  if (pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") {
      return applyCors(req, new NextResponse(null, { status: 204 }));
    }
    return applyCors(req, NextResponse.next());
  }

  // Always allow auth endpoints through.
  if (isAuthRoute(pathname)) return NextResponse.next();

  const token = req.cookies.get(getAuthCookieName())?.value;
  if (token) return NextResponse.next();

  // For API routes, return 401. For pages, redirect to "/login".
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/chat",
    "/chat/:path*",
    "/profile",
    "/profile/:path*",
    "/users",
    "/users/:path*",
    "/socket.io",
    "/socket.io/:path*"
  ]
};


