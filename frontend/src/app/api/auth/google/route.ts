import type { NextRequest } from "next/server";

import { proxyToBackend } from "../_proxy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Backend responds with a redirect to Google and sets oauth state cookies.
  return proxyToBackend(req, "/api/auth/google", { method: "GET" });
}
