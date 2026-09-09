/**
 * Report every stored image whose source resolution is too low for where it is
 * displayed, with the product/category it belongs to so it can be re-uploaded.
 *
 *   npx ts-node --transpile-only src/scripts/auditImageQuality.ts
 *
 * Why this exists: the delivery pipeline never upscales, by design — inventing
 * pixels produces a soft, smeared image. So when a source is narrower than the
 * box it renders into, the BROWSER stretches it, and that is the one kind of
 * blur no encoder setting can fix. Uploads are now blocked below the minimum
 * (see validateUploadResolution), but anything already stored predates that
 * check and has to be found and replaced by hand.
 *
 * Read-only. Changes nothing.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/prisma';
import { config } from '../config/env';
import { readImageMetadata, MIN_SOURCE_WIDTH } from '../utils/imagePipeline';

const root = () => path.resolve(config.upload.path);

/** Map a stored URL (absolute or relative) back to a path on disk. */
const toDiskPath = (url: string): string | null => {
  if (!url) return null;
  const m = url.match(/\/uploads\/(.+)$/i);
  if (!m) return null;
  return path.join(root(), decodeURIComponent(m[1]));
};

interface Row {
  kind: string;
  owner: string;
  file: string;
  width: number | null;
  height: number | null;
  required: number;
}

const inspect = async (kind: string, owner: string, url: string, folder: string): Promise<Row | null> => {
  const disk = toDiskPath(url);
  if (!disk || !fs.existsSync(disk)) return null;
  const required = MIN_SOURCE_WIDTH[folder] ?? 0;
  const meta = await readImageMetadata(disk);
  if (!meta?.width) return null;
  if (meta.width >= required) return null;
  return { kind, owner, file: path.basename(disk), width: meta.width, height: meta.height ?? null, required };
};

(async () => {
  const rows: Row[] = [];

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { name: true, slug: true, images: { select: { url: true } } },
  });
  for (const p of products) {
    for (const img of p.images) {
      const r = await inspect('product', `${p.name} (/${p.slug})`, img.url, 'products');
      if (r) rows.push(r);
    }
  }

  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    select: { name: true, slug: true, image: true, bannerImage: true },
  });
  for (const c of categories) {
    for (const url of [c.image, c.bannerImage]) {
      if (!url) continue;
      const r = await inspect('category', `${c.name} (/${c.slug})`, url, 'categories');
      if (r) rows.push(r);
    }
  }

  const banners = await prisma.banner.findMany({ select: { title: true, image: true } });
  for (const b of banners) {
    const r = await inspect('banner', b.title, b.image, 'banners');
    if (r) rows.push(r);
  }

  console.log('\n  IMAGES TOO SMALL FOR THEIR DISPLAY SIZE');
  console.log('  ' + '─'.repeat(94));

  if (rows.length === 0) {
    console.log('  None — every stored image meets the minimum for its surface.\n');
  } else {
    rows.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    console.log(
      '  ' + 'TYPE'.padEnd(10) + 'SIZE'.padEnd(13) + 'NEEDS'.padEnd(9) + 'UPSCALE'.padEnd(9) + 'ITEM'
    );
    for (const r of rows) {
      const factor = r.width ? (r.required / r.width).toFixed(1) + 'x' : '?';
      console.log(
        '  ' +
          r.kind.padEnd(10) +
          `${r.width}x${r.height}`.padEnd(13) +
          `${r.required}px`.padEnd(9) +
          factor.padEnd(9) +
          r.owner.slice(0, 46)
      );
    }
    console.log('  ' + '─'.repeat(94));
    console.log(`  ${rows.length} image(s) will look soft. Re-upload each at or above the "NEEDS" width.`);
    console.log('  Uploads below these minimums are now rejected, so this list can only shrink.\n');
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('Audit failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
