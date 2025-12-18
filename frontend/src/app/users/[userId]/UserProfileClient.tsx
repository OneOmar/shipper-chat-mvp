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
      className="h-14 w-14 rounded-full border border-chat-border object-cover"
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

  if (loading) return <div className="text-sm text-chat-muted">Loading…</div>;

  if (error) {
    return (
      <div className="rounded-chat-lg border border-chat-border bg-chat-bg/50 p-4 text-sm text-chat-text">
        <div className="font-medium">Couldn’t load profile</div>
        <div className="mt-1 text-chat-muted">{error}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
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
          <div className="truncate text-sm font-semibold text-chat-text">{title}</div>
          <div className="truncate text-xs text-chat-muted">{user.email}</div>
        </div>
        </div>

        {!isAi ? (
          <button
            type="button"
            onClick={startChat}
            disabled={chatting}
            className={[
              "shrink-0 rounded-chat-lg px-3 py-2 text-xs font-semibold",
              chatting ? "border border-chat-border bg-chat-bg text-chat-muted" : "bg-chat-primary text-chat-primary-foreground hover:brightness-[0.98]"
            ].join(" ")}
          >
            {chatting ? "Starting…" : "Chat"}
          </button>
        ) : null}
      </div>

      {chatError ? <div className="text-sm text-red-700">{chatError}</div> : null}

      <div className="rounded-chat-lg border border-chat-border bg-chat-surface2 p-4">
        <div className="text-xs font-medium text-chat-muted">Bio</div>
        <div className="mt-2 whitespace-pre-wrap text-sm text-chat-text">
          {user.bio?.trim() ? user.bio : <span className="text-chat-muted">No bio yet.</span>}
        </div>
      </div>
    </div>
  );
}

