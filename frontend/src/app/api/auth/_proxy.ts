import { NextResponse, type NextRequest } from "next/server";

function getBackendBase() {
  return (
    process.env.BACKEND_URL ||
    process.env.SOCKET_SERVER_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3001" : "")
  );
}

function appendSetCookie(from: Response, to: Headers) {
  // Undici supports multi Set-Cookie via getSetCookie()
  const anyHeaders = from.headers as unknown as { getSetCookie?: () => string[] };
  const setCookies = typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [];
  if (setCookies.length) {
    for (const c of setCookies) to.append("set-cookie", c);
    return;
  }
  const single = from.headers.get("set-cookie");
  if (single) to.set("set-cookie", single);
}

export async function proxyToBackend(
  req: NextRequest,
  backendPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const base = getBackendBase();
  if (!base) return NextResponse.json({ error: "Backend not configured" }, { status: 500 });

  const url = new URL(req.url);
  const target = `${base}${backendPath}${url.search}`;

  const cookie = req.headers.get("cookie");
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);

  const upstream = await fetch(target, {
    ...init,
    headers,
    // IMPORTANT: we must preserve Location + Set-Cookie for browser navigations
    redirect: "manual"
  });

  const outHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) outHeaders.set("content-type", contentType);
  const location = upstream.headers.get("location");
  if (location) outHeaders.set("location", location);
  appendSetCookie(upstream, outHeaders);

  // Avoid buffering large bodies; these endpoints are small.
  const bodyText = await upstream.text();
  return new Response(bodyText, { status: upstream.status, headers: outHeaders });
}

