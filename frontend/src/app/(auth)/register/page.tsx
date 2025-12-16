import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthCookieName, verifyAuthToken } from "@/lib/auth";
import { RegisterForm } from "./RegisterForm";

export default async function RegisterPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAuthCookieName())?.value;
  if (token && verifyAuthToken(token)) redirect("/chat");

  return <RegisterForm />;
}


