import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthCookieName, verifyAuthToken } from "@/lib/auth";
import { ChatShell } from "./ChatShell";

export const runtime = "nodejs";

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAuthCookieName())?.value ?? "";
  const ok = token ? verifyAuthToken(token) : null;
  if (!ok) redirect("/login");

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100">
      <ChatShell>{children}</ChatShell>
    </div>
  );
}


