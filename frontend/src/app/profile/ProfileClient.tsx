"use client";

import { useEffect, useMemo, useState } from "react";

type MeUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  createdAt: string;
};

function AvatarPreview({ name, email, image }: { name: string | null; email: string; image: string | null }) {
  const label = (name ?? "").trim() || email;
  const src = image || "/avatar-placeholder.svg";
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

export function ProfileClient() {
  const [me, setMe] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");

  const imageForPreview = useMemo(() => me?.image ?? null, [me]);

  const isDirty = useMemo(() => {
    if (!me) return false;
    const n = name.trim();
    const b = bio.trim();
    return (me.name ?? "") !== n || (me.bio ?? "") !== b;
  }, [me, name, bio]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load profile");
        const json = (await res.json()) as { user: MeUser };
        if (!mounted) return;
        setMe(json.user);
        setName(json.user.name ?? "");
        setBio(json.user.bio ?? "");
      } catch {
        if (!mounted) return;
        setError("Couldn’t load your profile. Please refresh.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: name.trim(),
        bio: bio.trim()
      };
      const res = await fetch("/api/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });

      const json = (await res.json().catch(() => null)) as { user?: MeUser; error?: string } | null;
      if (!res.ok) {
        setError(json?.error || "Couldn’t save. Please try again.");
        return;
      }

      if (json?.user) {
        setMe(json.user);
        setName(json.user.name ?? "");
        setBio(json.user.bio ?? "");
      }
      setNotice("Saved.");
      window.setTimeout(() => setNotice(null), 2500);
    } catch {
      setError("Couldn’t save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-zinc-500">Loading…</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-200">
        <div className="font-medium">Something went wrong</div>
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

  if (!me) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <AvatarPreview name={name.trim() || null} email={me.email} image={imageForPreview} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{name.trim() || me.email}</div>
          <div className="truncate text-xs text-zinc-500">{me.email}</div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-300">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={50}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
          <div className="mt-1 text-[11px] text-zinc-600">{name.trim().length}/50</div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short public bio (optional)"
            maxLength={280}
            rows={4}
            className="mt-2 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
          <div className="mt-1 text-[11px] text-zinc-600">{bio.trim().length}/280</div>
        </div>

        {notice ? <div className="text-sm text-emerald-400">{notice}</div> : null}
        {error ? <div className="text-sm text-red-400">{error}</div> : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !isDirty}
            className={[
              "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium",
              saving || !isDirty
                ? "bg-zinc-800 text-zinc-500"
                : "bg-zinc-100 text-zinc-950 hover:bg-white"
            ].join(" ")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <div className="text-xs text-zinc-600">Public fields: name, bio.</div>
        </div>
      </div>
    </div>
  );
}

