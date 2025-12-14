import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/server-auth";
import { getOrCreateAiUser } from "@/lib/ai-user";

export const runtime = "nodejs";

export async function POST() {
  const me = await requireAuthUser();
  const aiUser = await getOrCreateAiUser();

  const candidates = await prisma.chatSession.findMany({
    where: {
      type: "ai",
      participants: {
        some: { userId: me.sub }
      }
    },
    include: { participants: true },
    orderBy: { createdAt: "desc" }
  });

  const existing = candidates.find((s) => {
    if (s.participants.length !== 2) return false;
    const ids = new Set(s.participants.map((p) => p.userId));
    return ids.has(me.sub) && ids.has(aiUser.id);
  });

  if (existing) return NextResponse.json({ sessionId: existing.id });

  const created = await prisma.chatSession.create({
    data: {
      type: "ai",
      participants: {
        create: [{ userId: me.sub }, { userId: aiUser.id }]
      }
    },
    select: { id: true }
  });

  return NextResponse.json({ sessionId: created.id }, { status: 201 });
}


