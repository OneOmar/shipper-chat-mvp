"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconLogout } from "@/app/_components/icons";

export function LogoutButton({ className, iconOnly }: { className?: string; iconOnly?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      router.replace("/login");
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loading}
      aria-label={iconOnly ? (loading ? "Logging out…" : "Logout") : undefined}
      className={[
        "inline-flex items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg disabled:cursor-not-allowed disabled:opacity-60",
        className ?? ""
      ].join(" ")}
    >
      {iconOnly ? (
        loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-chat-border border-t-chat-primary" />
        ) : (
          <IconLogout className="h-5 w-5" />
        )
      ) : loading ? (
        "Logging out…"
      ) : (
        "Logout"
      )}
    </button>
  );
}


