/*
  Railway preDeploy helper.

  Fixes Prisma P3009 caused by a previously failed migration.
  Specifically handles: 20251219000000_add_participant_last_read_at

  Strategy:
  - If Participant.lastReadAt exists: mark migration as applied.
  - Else: mark migration as rolled-back (so it can be reapplied), then run migrate deploy.

  This is intentionally narrow and safe for production.
*/

const { execSync } = require("node:child_process");

const MIGRATION = "20251219000000_add_participant_last_read_at";

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function main() {
  // Lazy require so this file can run even if Prisma client isn't generated yet.
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Confirm we can connect.
    await prisma.$queryRawUnsafe("SELECT 1");

    const rows = await prisma.$queryRawUnsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'Participant' AND column_name = 'lastReadAt'"
    );

    const hasColumn = Array.isArray(rows) && rows.length > 0;

    if (hasColumn) {
      console.log(`Detected Participant.lastReadAt exists; resolving migration as applied: ${MIGRATION}`);
      sh(`npx prisma migrate resolve --applied ${MIGRATION}`);
    } else {
      console.log(`Participant.lastReadAt not found; resolving migration as rolled-back: ${MIGRATION}`);
      sh(`npx prisma migrate resolve --rolled-back ${MIGRATION}`);
    }

    // Now apply any pending migrations.
    sh("npx prisma migrate deploy");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("railway-migrate failed:", err);
  process.exit(1);
});
