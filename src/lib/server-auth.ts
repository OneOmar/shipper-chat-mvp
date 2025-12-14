import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME, type AuthJwtPayload, verifyAuthToken } from "@/lib/auth";

export async function getAuthUserFromCookies(): Promise<AuthJwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAuthToken(token);
}

export async function requireAuthUser(): Promise<AuthJwtPayload> {
  const user = await getAuthUserFromCookies();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}


