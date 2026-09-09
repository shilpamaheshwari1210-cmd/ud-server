/**
 * One-time backfill: mark every pre-existing account as verified.
 *
 * Email verification is being switched on, and sign-in now refuses an
 * unverified account. Every customer who registered before this existed has
 * `isVerified: false` — not because they failed a check, but because nothing
 * ever ran one. Without this they would all be locked out of accounts they
 * have been using perfectly well.
 *
 * Run it BEFORE deploying the login guard. Idempotent: re-running touches
 * nothing, because it only selects rows that are still unverified.
 */
import { prisma } from '../config/prisma';

async function main() {
  const cutoff = new Date();

  const pending = await prisma.user.findMany({
    where: { isVerified: false, deletedAt: null },
    select: { id: true, email: true, createdAt: true },
  });

  if (!pending.length) {
    console.log('Nothing to do — no unverified accounts.');
    return;
  }

  console.log(`Grandfathering ${pending.length} existing account(s):`);
  for (const u of pending) {
    console.log(`  ${u.email}  (registered ${u.createdAt.toISOString().slice(0, 10)})`);
  }

  const { count } = await prisma.user.updateMany({
    where: { isVerified: false, deletedAt: null, createdAt: { lt: cutoff } },
    data: { isVerified: true, emailVerifiedAt: cutoff },
  });

  console.log(`\nDone. ${count} account(s) marked verified.`);
}

main()
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
