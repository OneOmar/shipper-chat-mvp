import type { NextRequest } from "next/server";

import { proxyToBackend } from "../../auth/_proxy";

export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const body = await req.text();
  return proxyToBackend(req, "/api/me/profile", {
    method: "PUT",
    headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
    body
  });
}

