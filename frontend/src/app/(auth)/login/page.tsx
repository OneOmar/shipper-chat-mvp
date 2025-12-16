import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthCookieName, verifyAuthToken } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAuthCookieName())?.value;
  if (token && verifyAuthToken(token)) redirect("/chat");

  return <LoginForm />;
}


