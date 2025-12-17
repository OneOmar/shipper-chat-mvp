import type { NextRequest } from "next/server";

import { proxyToBackend } from "../auth/_proxy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return proxyToBackend(req, "/api/me", { method: "GET" });
}

