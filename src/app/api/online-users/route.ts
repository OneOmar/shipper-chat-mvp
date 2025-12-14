import { NextResponse } from "next/server";

import { getOnlineUsers } from "@/server/socket";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ onlineUsers: getOnlineUsers() });
}


