import { cookies } from "next/headers";

import { getAuthCookieName, verifyAuthToken } from "@/lib/auth";
import { Header } from "./_components/Header";
import { HeroSection } from "./_components/HeroSection";

export const runtime = "nodejs";

export default async function Page() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAuthCookieName())?.value ?? "";
  const isAuthed = !!(token && verifyAuthToken(token));

  return (
    <div className="chat-theme min-h-screen bg-chat-bg text-chat-text">
      <Header isAuthed={isAuthed} />

      <main>
        <HeroSection isAuthed={isAuthed} />
      </main>
    </div>
  );
}


