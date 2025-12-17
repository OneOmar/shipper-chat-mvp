"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  createdAt: string;
};

function Avatar({ user }: { user: Pick<PublicUser, "name" | "email" | "image"> }) {
  const label = user.name?.trim() || user.email;
  const src = user.image || "/avatar-placeholder.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      className="h-14 w-14 rounded-full border border-zinc-800 object-cover"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src.endsWith("/avatar-placeholder.svg")) return;
        el.src = "/avatar-placeholder.svg";
      }}
    />
  );
}

export function UserProfileClient({ userId }: { userId: string }) {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatting, setChatting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const title = useMemo(() => user?.name?.trim() || user?.email || "User", [user]);
  const isAi = useMemo(() => user?.name === "AI" || user?.email === "ai@local", [user]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, { credentials: "include" });
        const json = (await res.json().catch(() => null)) as { user?: PublicUser; error?: string } | null;
        if (!res.ok) {
          throw new Error(json?.error || "Failed to load");
        }
        if (!mounted) return;
        setUser(json?.user ?? null);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Couldn’t load profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [userId]);

  if (loading) return <div className="text-sm text-zinc-500">Loading…</div>;

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-200">
        <div className="font-medium">Couldn’t load profile</div>
        <div className="mt-1 text-zinc-400">{error}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (!user) return null;

  async function startChat() {
    if (chatting) return;
    setChatError(null);
    setChatting(true);
    try {
      const res = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId })
      });
      const json = (await res.json().catch(() => null)) as { sessionId?: string; error?: string } | null;
      if (!res.ok || !json?.sessionId) {
        setChatError(json?.error || "Couldn’t start chat.");
        return;
      }
      router.push(`/chat/${encodeURIComponent(json.sessionId)}?user=${encodeURIComponent(userId)}`);
    } catch {
      setChatError("Couldn’t start chat.");
    } finally {
      setChatting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
        <Avatar user={user} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{title}</div>
          <div className="truncate text-xs text-zinc-500">{user.email}</div>
        </div>
        </div>

        {!isAi ? (
          <button
            type="button"
            onClick={startChat}
            disabled={chatting}
            className={[
              "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium",
              chatting ? "bg-zinc-800 text-zinc-500" : "bg-zinc-100 text-zinc-950 hover:bg-white"
            ].join(" ")}
          >
            {chatting ? "Starting…" : "Chat"}
          </button>
        ) : null}
      </div>

      {chatError ? <div className="text-sm text-red-400">{chatError}</div> : null}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="text-xs font-medium text-zinc-400">Bio</div>
        <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-100">
          {user.bio?.trim() ? user.bio : <span className="text-zinc-500">No bio yet.</span>}
        </div>
      </div>
    </div>
  );
}

