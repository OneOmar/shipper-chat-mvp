import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}


