import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/server-auth";

export const runtime = "nodejs";

type Body = { userId?: string };

export async function POST(req: Request) {
  const me = await requireAuthUser();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const otherUserId = typeof body.userId === "string" ? body.userId : "";
  if (!otherUserId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  if (otherUserId === me.sub) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });

  // Find any session that contains both users, then pick the one that is exactly a 1:1 session.
  const candidates = await prisma.chatSession.findMany({
    where: {
      type: "direct",
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
    return ids.has(me.sub) && ids.has(otherUserId);
  });

  if (existing) {
    return NextResponse.json({ sessionId: existing.id });
  }

  const created = await prisma.chatSession.create({
    data: {
      type: "direct",
      participants: {
        create: [{ userId: me.sub }, { userId: otherUserId }]
      }
    },
    select: { id: true }
  });

  return NextResponse.json({ sessionId: created.id }, { status: 201 });
}


