import jwt from "jsonwebtoken";

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "auth_token";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

export type AuthJwtPayload = {
  sub: string;
  email: string;
};

export function assertJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error("Missing JWT_SECRET environment variable");
  }
}

export function signAuthToken(payload: AuthJwtPayload) {
  assertJwtSecret();
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: "7d" });
}

export function verifyAuthToken(token: string): AuthJwtPayload | null {
  try {
    assertJwtSecret();
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
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
    maxAge: 60 * 60 * 24 * 7
  };
}


