"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useChatShell } from "../ChatShell";

type User = { id: string; name: string | null; email: string; image: string | null };

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  senderId: string;
  sessionId: string;
  createdAt: string;
  sender: User;
};

type AiMessageStartEvent = { tempId: string; sessionId: string; sender: User };
type AiMessageDeltaEvent = { tempId: string; sessionId: string; delta: string; content: string };
type AiMessageDoneEvent = { tempId: string; sessionId: string; message: Message };

function isAi(sender: User) {
  return sender.name === "AI" || sender.email === "ai@local";
}

function MiniAvatar({ sender }: { sender: User }) {
  if (isAi(sender)) {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
        AI
      </div>
    );
  }

  const src = sender.image || "/avatar-placeholder.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={sender.name || sender.email}
      className="h-7 w-7 rounded-full object-cover"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src.endsWith("/avatar-placeholder.svg")) return;
        el.src = "/avatar-placeholder.svg";
      }}
    />
  );
}

export function ChatClient({
  meUserId,
  sessionId,
  participants,
  initialMessages
}: {
  meUserId: string;
  sessionId: string;
  participants: User[];
  initialMessages: Message[];
}) {
  const { openSidebar } = useChatShell();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(() => {
    const other = participants.find((p) => p.id !== meUserId);
    return other?.name || other?.email || "Chat";
  }, [participants, meUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    let s: Socket | null = null;
    let cancelled = false;

    async function connect() {
      setError(null);
      setConnected(false);
      setJoined(false);
      // Ensure the Socket.IO server is initialized.
      await fetch("/api/socket", { credentials: "include" });
      if (cancelled) return;

      s = io({ path: "/socket.io", withCredentials: true });
      setSocket(s);

      s.on("connect_error", () => setError("Realtime connection failed"));
      s.on("connect", () => setConnected(true));
      s.on("disconnect", () => setConnected(false));

      s.on("receive_message", (msg: Message) => {
        if (msg.sessionId !== sessionId) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          // If a streaming AI temp message exists, drop it once the final arrives.
          const withoutTempAi = prev.filter((m) => !(m.id.startsWith("temp:") && m.role === "assistant"));
          return [...withoutTempAi, msg];
        });
      });

      s.on("ai_message_start", (evt: AiMessageStartEvent) => {
        if (evt.sessionId !== sessionId) return;
        setMessages((prev) => [
          ...prev,
          {
            id: `temp:${evt.tempId}`,
            content: "",
            role: "assistant",
            senderId: evt.sender.id,
            sessionId,
            createdAt: new Date().toISOString(),
            sender: evt.sender
          }
        ]);
      });

      s.on("ai_message_delta", (evt: AiMessageDeltaEvent) => {
        if (evt.sessionId !== sessionId) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === `temp:${evt.tempId}` ? { ...m, content: evt.content } : m))
        );
      });

      s.on("ai_message_done", (evt: AiMessageDoneEvent) => {
        if (evt.sessionId !== sessionId) return;
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== `temp:${evt.tempId}`);
          if (next.some((m) => m.id === evt.message.id)) return next;
          return [...next, evt.message];
        });
      });

      s.emit("join_session", sessionId, (ok: boolean) => {
        setJoined(ok);
        if (!ok) setError("Unable to join session");
      });
    }

    connect();
    return () => {
      cancelled = true;
      if (s) s.disconnect();
      setSocket(null);
    };
  }, [sessionId, reconnectKey]);

  async function send() {
    const text = content.trim();
    if (!text || !socket || !connected || !joined) return;
    setError(null);
    setSending(true);
    setContent("");

    socket.emit(
      "send_message",
      { sessionId, content: text },
      (resp: Message | { error: string }) => {
        setSending(false);
        if ("error" in resp) {
          setError(resp.error);
          setContent(text);
          return;
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === resp.id)) return prev;
          return [...prev, resp];
        });
      }
    );
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const canType = connected && joined && !sending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900 md:hidden"
              onClick={openSidebar}
              aria-label="Open sidebar"
            >
              <span className="text-lg leading-none">≡</span>
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-100">{title}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={["h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-zinc-600"].join(" ")} />
            <span>{connected ? (joined ? "Connected" : "Joining…") : "Disconnected"}</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-center">
              <div className="text-sm font-medium text-zinc-100">No messages yet</div>
              <div className="mt-1 text-sm text-zinc-400">Send a message to start the conversation.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => {
              const mine = m.senderId === meUserId;
              return (
                <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={["flex max-w-[90%] items-end gap-2", mine ? "justify-end" : "justify-start"].join(" ")}
                  >
                    {mine ? null : <MiniAvatar sender={m.sender} />}
                    <div
                      className={[
                        "rounded-2xl px-3 py-2 text-sm",
                        mine
                          ? "bg-zinc-100 text-zinc-900"
                          : isAi(m.sender)
                            ? "bg-indigo-950/40 text-zinc-100 border border-indigo-900/50"
                            : "bg-zinc-900/60 text-zinc-100 border border-zinc-800"
                      ].join(" ")}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      <div className={["mt-1 text-[11px]", mine ? "text-zinc-600" : "text-zinc-400"].join(" ")}>
                        {mine ? "You" : m.sender.name || m.sender.email}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 px-6 py-4">
        {error ? (
          <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{error}</div>
              <button
                type="button"
                onClick={() => setReconnectKey((k) => k + 1)}
                className="shrink-0 rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs text-red-100 hover:bg-red-950/60"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-end gap-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Type a message…"
            rows={2}
            disabled={!canType}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={send}
            disabled={!canType || !content.trim()}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {connected ? (joined ? "Enter to send • Shift+Enter for newline" : "Joining session…") : "Disconnected — messages are disabled."}
        </div>
      </div>
    </div>
  );
}


