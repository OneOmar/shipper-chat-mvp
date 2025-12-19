import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";

import { ChatClient } from "./ChatClient";

export const runtime = "nodejs";

function getRequestOrigin(h: Headers) {
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0]?.trim() || "http";
  const host =
    (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]?.trim() || "";
  return host ? `${proto}://${host}` : "";
}

export default async function ChatSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const origin = getRequestOrigin(await headers());
  if (!origin) notFound();

  const res = await fetch(`${origin}/api/chat/session/${encodeURIComponent(sessionId)}/bootstrap`, {
    method: "GET",
    cache: "no-store",
    headers: cookieHeader ? { cookie: cookieHeader } : undefined
  });

  if (!res.ok) notFound();
  const data = (await res.json().catch(() => null)) as
    | {
        meUserId: string;
        sessionId: string;
        participants: Array<{ id: string; name: string | null; email: string; image: string | null }>;
        lastReadAtByUserId?: Record<string, string>;
        initialMessages: Array<{
          id: string;
          content: string;
          role: "user" | "assistant";
          senderId: string;
          sessionId: string;
          createdAt: string;
          sender: { id: string; name: string | null; email: string; image: string | null };
        }>;
      }
    | null;

  if (!data?.sessionId || !data?.meUserId) notFound();

  return (
    <ChatClient
      meUserId={data.meUserId}
      sessionId={data.sessionId}
      participants={data.participants}
      initialMessages={data.initialMessages}
      lastReadAtByUserId={data.lastReadAtByUserId ?? {}}
    />
  );
}


