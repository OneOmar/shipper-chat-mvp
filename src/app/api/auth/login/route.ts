import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { authCookieOptions, getAuthCookieName, signAuthToken } from "@/lib/auth";

export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(req: Request) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !email.includes("@") || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      name: true,
      image: true,
      createdAt: true
    }
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signAuthToken({ sub: user.id, email: user.email });

  const res = NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        createdAt: user.createdAt
      }
    },
    { status: 200 }
  );
  res.cookies.set(getAuthCookieName(), token, authCookieOptions());
  return res;
}


