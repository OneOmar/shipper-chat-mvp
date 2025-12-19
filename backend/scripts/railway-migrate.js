/*
  Railway preDeploy helper.

  Fixes Prisma P3009 caused by a previously failed migration.
  Specifically handles: 20251219000000_add_participant_last_read_at

  Strategy:
  - Always clear the failed migration state by resolving it as rolled-back (idempotent).
  - The migration SQL is written with IF NOT EXISTS, so re-applying is safe.
  - Then run migrate deploy to apply any pending migrations.

  This is intentionally narrow and safe for production.
*/

const { execSync } = require("node:child_process");

const MIGRATION = "20251219000000_add_participant_last_read_at";

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function trySh(cmd) {
  try {
    sh(cmd);
    return true;
  } catch (e) {
    console.warn(`Command failed (continuing): ${cmd}`);
    return false;
  }
}

async function main() {
  console.log(`Ensuring failed migration is cleared: ${MIGRATION}`);
  // Mark as rolled back to unblock P3009. If it's already resolved, Prisma will error—ignore.
  trySh(`npx prisma migrate resolve --rolled-back ${MIGRATION}`);

  // Now apply any pending migrations (including re-applying the above safely).
  sh("npx prisma migrate deploy");
}

main().catch((err) => {
  console.error("railway-migrate failed:", err);
  process.exit(1);
});
