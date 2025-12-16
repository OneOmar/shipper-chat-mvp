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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header isAuthed={isAuthed} />

      <main>
        <HeroSection isAuthed={isAuthed} />
      </main>
    </div>
  );
}


