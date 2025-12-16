import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // In production the Socket.IO server runs as a standalone process.
  // This route remains for compatibility with the existing frontend, and simply proxies
  // to the socket server's `/api/online-users` endpoint.
  const base = process.env.SOCKET_SERVER_URL;
  if (!base) return NextResponse.json({ onlineUsers: [] });

  try {
    const res = await fetch(`${base}/api/online-users`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ onlineUsers: [] });
    const json = (await res.json().catch(() => null)) as { onlineUsers?: unknown } | null;
    return NextResponse.json({ onlineUsers: (json as { onlineUsers?: unknown[] })?.onlineUsers ?? [] });
  } catch {
    return NextResponse.json({ onlineUsers: [] });
  }
}


