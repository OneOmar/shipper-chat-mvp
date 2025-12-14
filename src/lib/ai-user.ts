import bcrypt from "bcrypt";

import { prisma } from "@/lib/prisma";

const AI_USER_EMAIL = process.env.AI_USER_EMAIL ?? "ai@local";

export async function getOrCreateAiUser() {
  const existing = await prisma.user.findUnique({ where: { email: AI_USER_EMAIL } });
  if (existing) return existing;

  // Not a seed: created lazily on first use.
  const passwordHash = await bcrypt.hash(`ai-${crypto.randomUUID()}`, 10);
  return prisma.user.create({
    data: {
      email: AI_USER_EMAIL,
      name: "AI",
      image: null,
      password: passwordHash
    }
  });
}


