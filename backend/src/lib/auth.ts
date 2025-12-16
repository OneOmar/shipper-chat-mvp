import jwt from "jsonwebtoken";

/**
 * Backend auth utilities (JWT + cookie settings).
 *
 * Kept intentionally aligned with the frontend's `src/lib/auth.ts` so that:
 * - Next.js can do lightweight auth gating (optional)
 * - the backend remains the source of truth for API + Socket auth
 *
 * NOTE:
 * Do NOT read env vars once at module-import time.
 * This server loads dotenv at runtime and static imports can be evaluated
 * before dotenv runs. If we snapshot `JWT_SECRET`/cookie name too early,
 * auth can fail unexpectedly.
 */
export function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "auth_token";
}

function getJwtSecret() {
  return process.env.JWT_SECRET ?? "";
}

export type AuthJwtPayload = {
  sub: string;
  email: string;
};

export function assertJwtSecret() {
  if (!getJwtSecret()) {
    throw new Error("Missing JWT_SECRET environment variable");
  }
}

export function signAuthToken(payload: AuthJwtPayload) {
  assertJwtSecret();
  return jwt.sign(payload, getJwtSecret(), { algorithm: "HS256", expiresIn: "7d" });
}

export function verifyAuthToken(token: string): AuthJwtPayload | null {
  try {
    assertJwtSecret();
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || decoded === null) return null;
    const sub = (decoded as { sub?: unknown }).sub;
    const email = (decoded as { email?: unknown }).email;
    if (typeof sub !== "string" || typeof email !== "string") return null;
    return { sub, email };
  } catch {
    return null;
  }
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // seconds (mirrors Next.js cookie options usage)
    maxAge: 60 * 60 * 24 * 7
  };
}

