import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/server-auth";

export const runtime = "nodejs";

type SessionRow = { sessionId: string; userId: string };

export async function GET() {
  const me = await requireAuthUser();

  const sessions = await prisma.chatSession.findMany({
    where: {
      type: "direct",
      participants: { some: { userId: me.sub } }
    },
    include: { participants: { select: { userId: true } } },
    orderBy: { createdAt: "desc" }
  });

  const out: SessionRow[] = [];
  for (const s of sessions) {
    if (s.participants.length !== 2) continue;
    const other = s.participants.find((p) => p.userId !== me.sub);
    if (!other?.userId) continue;
    out.push({ sessionId: s.id, userId: other.userId });
  }

  return NextResponse.json({ sessions: out });
}

