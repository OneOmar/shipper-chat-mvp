import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/server-auth";
import { ChatClient } from "./ChatClient";

export const runtime = "nodejs";

export default async function ChatSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const me = await requireAuthUser();
  const { sessionId } = await params;

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true, image: true } } } }
    }
  });

  if (!session) notFound();
  const isMember = session.participants.some((p) => p.userId === me.sub);
  if (!isMember) notFound();

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { id: true, name: true, email: true, image: true } } }
  });

  return (
    <ChatClient
      meUserId={me.sub}
      sessionId={sessionId}
      participants={session.participants.map((p) => p.user)}
      initialMessages={messages.map((m) => ({
        id: m.id,
        content: m.content,
        role: m.role,
        senderId: m.senderId,
        sessionId: m.sessionId,
        createdAt: m.createdAt.toISOString(),
        sender: m.sender
      }))}
    />
  );
}


