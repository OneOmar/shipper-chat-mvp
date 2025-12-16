import type { NextRequest } from "next/server";

import { proxyToBackend } from "../_proxy";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  return proxyToBackend(req, "/api/auth/register", {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
    body
  });
}
