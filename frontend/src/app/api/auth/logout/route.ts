import type { NextRequest } from "next/server";

import { proxyToBackend } from "../_proxy";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return proxyToBackend(req, "/api/auth/logout", { method: "POST" });
}
