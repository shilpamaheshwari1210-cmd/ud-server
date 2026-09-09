/**
 * Point the logo settings at the corrected brand assets.
 *
 *   npx ts-node --transpile-only src/scripts/updateLogoSettings.ts
 *
 * Why this exists: initDatabase() seeds settings with
 * `createMany({ skipDuplicates: true })`, which deliberately never overwrites
 * admin edits. That also means an existing install keeps `logo_url=/logo.jpg`
 * forever, so the seed-default change alone does nothing on a live server.
 *
 * The old asset was a 4500x4500 square with ~60% white padding. Any renderer
 * using `width: auto` with a fixed height therefore produced a 1:1 logo. The
 * replacement is trimmed to the artwork (600x333, ratio 1.802) with a
 * transparent background, plus a light colourway for the dark footer.
 *
 * Safe to re-run. Skips a value the admin has deliberately pointed at their own
 * uploaded file, unless --force is passed.
 */
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

const NEW_DARK = '/logo-mark.png';
const NEW_LIGHT = '/logo-mark-light.png';

// Values we consider "the old default" and are therefore safe to replace.
const REPLACEABLE = ['/logo.jpg', '/logo.jpeg', '/logo.png', ''];

const force = process.argv.includes('--force');

(async () => {
  const existing = await prisma.setting.findUnique({ where: { key: 'logo_url' } });

  if (!existing) {
    await prisma.setting.create({
      data: { key: 'logo_url', value: NEW_DARK, group: 'general', label: 'Logo URL' },
    });
    console.log(`  created logo_url = ${NEW_DARK}`);
  } else if (force || REPLACEABLE.includes((existing.value || '').trim())) {
    await prisma.setting.update({ where: { key: 'logo_url' }, data: { value: NEW_DARK } });
    console.log(`  logo_url: "${existing.value}" -> "${NEW_DARK}"`);
  } else {
    console.log(`  logo_url left as "${existing.value}" (admin-set; pass --force to override)`);
  }

  await prisma.setting.upsert({
    where: { key: 'logo_url_light' },
    create: {
      key: 'logo_url_light',
      value: NEW_LIGHT,
      group: 'general',
      label: 'Logo URL (light, for dark backgrounds)',
    },
    update: force ? { value: NEW_LIGHT } : {},
  });
  console.log(`  logo_url_light ready (${NEW_LIGHT})`);

  await prisma.$disconnect();
  console.log('\nDone. Restart is not required — settings are read per request.\n');
})().catch(async (error) => {
  logger.error('Logo settings update failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
