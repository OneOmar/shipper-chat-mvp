import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="chat-theme h-[100dvh] overflow-hidden bg-chat-bg text-chat-text">
      <div className="mx-auto flex h-[100dvh] w-full max-w-md flex-col justify-center px-4 sm:px-6">
        <div className="rounded-chat-xl border border-chat-border bg-chat-surface p-6 shadow-chat-card ring-1 ring-chat-border/60 sm:p-7">
          {children}
        </div>

        <div className="mt-4 text-center text-xs text-chat-muted">
          By continuing, you agree to our terms and privacy policy.
        </div>
      </div>
    </div>
  );
}


