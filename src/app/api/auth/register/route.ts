import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { authCookieOptions, getAuthCookieName, signAuthToken } from "@/lib/auth";

export const runtime = "nodejs";

type RegisterBody = {
  name?: string;
  email?: string;
  image?: string;
  password?: string;
};

export async function POST(req: Request) {
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : null;
  const image = typeof body.image === "string" ? body.image.trim() : null;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      name: name || undefined,
      image: image || undefined
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      createdAt: true
    }
  });

  const token = signAuthToken({ sub: user.id, email: user.email });

  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(getAuthCookieName(), token, authCookieOptions());
  return res;
}


