import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const me = await requireAuthUser();

  const users = await prisma.user.findMany({
    where: { id: { not: me.sub } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true, image: true }
  });

  return NextResponse.json({ users });
}


