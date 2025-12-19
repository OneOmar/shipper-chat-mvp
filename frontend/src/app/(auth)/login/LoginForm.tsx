"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password })
      });

      const data = (await res.json().catch(() => null)) as { error?: string } | null;

      if (!res.ok) {
        setError(data?.error ?? "Login failed");
        return;
      }

      router.replace("/chat");
      router.refresh();
    } catch {
      setError("Login failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">Login</h1>
        <p className="text-sm text-chat-muted">Sign in to continue.</p>
      </div>

      <a
        href="/api/auth/google"
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-chat-lg border border-chat-border bg-chat-surface px-4 text-sm font-medium text-chat-text/90 hover:bg-chat-bg"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
        >
          <path
            fill="#EA4335"
            d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.2 14.7 2 12 2 6.8 2 2.6 6.2 2.6 11.8S6.8 21.6 12 21.6c6.9 0 8.6-4.9 8.6-7.5 0-.5-.1-.9-.1-1.3H12z"
          />
          <path
            fill="#34A853"
            d="M3.9 7.3l3.2 2.4C8 7.4 9.9 5.7 12 5.7c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.2 14.7 2 12 2 8.2 2 5 4.3 3.9 7.3z"
            opacity=".001"
          />
          <path
            fill="#FBBC05"
            d="M12 21.6c2.6 0 4.8-.9 6.4-2.4l-3.1-2.4c-.8.6-1.9 1-3.3 1-2.5 0-4.6-1.7-5.3-4l-3.2 2.5c1.2 3 4.1 5.3 8.5 5.3z"
          />
          <path
            fill="#4285F4"
            d="M20.5 11.8c0-.5-.1-.9-.1-1.3H12v3.9h5.5c-.3 1.1-1.2 2.6-2.9 3.4l3.1 2.4c1.8-1.7 2.8-4.1 2.8-7.4z"
          />
        </svg>
        Continue with Google
      </a>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-chat-border" />
        <div className="text-xs text-chat-muted">or</div>
        <div className="h-px flex-1 bg-chat-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-chat-text">Email</span>
          <input
            className="h-11 w-full rounded-chat-lg border border-chat-border bg-chat-surface px-4 text-sm text-chat-text outline-none placeholder:text-chat-muted/70 focus:border-chat-primary focus:ring-2 focus:ring-chat-ring/20"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-chat-text">Password</span>
          <div className="relative">
            <input
              className="h-11 w-full rounded-chat-lg border border-chat-border bg-chat-surface px-4 pr-16 text-sm text-chat-text outline-none placeholder:text-chat-muted/70 focus:border-chat-primary focus:ring-2 focus:ring-chat-ring/20"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-chat-lg px-2.5 py-1 text-xs font-medium text-chat-muted hover:bg-chat-bg"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        {error ? (
          <div className="rounded-chat-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex h-11 w-full items-center justify-center rounded-chat-lg bg-chat-primary px-4 text-sm font-semibold text-chat-primary-foreground hover:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="text-sm text-chat-muted">
        Don&apos;t have an account?{" "}
        <Link className="font-medium text-chat-primary hover:underline hover:underline-offset-4" href="/register">
          Register
        </Link>
      </p>
    </div>
  );
}


