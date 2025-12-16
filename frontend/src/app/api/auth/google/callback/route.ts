import type { NextRequest } from "next/server";

import { proxyToBackend } from "../../_proxy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Backend validates oauth state cookies and then sets the auth cookie + redirects.
  return proxyToBackend(req, "/api/auth/google/callback", { method: "GET" });
}
