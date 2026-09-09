/**
 * Pre-generate image derivatives for every image already on disk.
 *
 *   npx ts-node --transpile-only src/scripts/warmImageCache.ts [--dry-run] [--folder=products]
 *
 * Existing uploads predate the derivative pipeline, so without this the first
 * visitor to each product page pays the transform cost. Run it once after
 * deploying, then again after any bulk import.
 *
 * Safe to interrupt and re-run: already-cached derivatives are skipped, so a
 * second run only picks up what the first one missed.
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import {
  getDerivative,
  getLqip,
  readImageMetadata,
  RESPONSIVE_WIDTHS,
  QUALITY_DEFAULTS,
} from '../utils/imagePipeline';

const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif']);

// Same ladder the pipeline pre-warms on upload.
const WIDTHS: Record<'avif' | 'webp', number[]> = {
  avif: [256, 480, 640, 828, 1080, 1440, 1920],
  webp: [480, 828],
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const folderArg = args.find((a) => a.startsWith('--folder='))?.split('=')[1];

const walk = (dir: string, out: string[] = []): string[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // Never descend into the derivative cache itself.
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
};

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

(async () => {
  const root = path.resolve(config.upload.path);
  const target = folderArg ? path.join(root, folderArg) : root;

  if (!fs.existsSync(target)) {
    logger.error(`Upload path does not exist: ${target}`);
    process.exit(1);
  }

  const files = walk(target);
  const sourceBytes = files.reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);

  console.log(`\nScanning ${target}`);
  console.log(`Found ${files.length} source image(s), ${mb(sourceBytes)} total\n`);

  if (files.length === 0) return;
  if (dryRun) {
    const perImage = WIDTHS.avif.length + WIDTHS.webp.length;
    console.log(`--dry-run: would generate up to ${files.length * perImage} derivatives.`);
    console.log('Re-run without --dry-run to execute.\n');
    return;
  }

  let done = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let derivativeBytes = 0;
  const startedAt = Date.now();

  for (const file of files) {
    const meta = await readImageMetadata(file);
    if (!meta) {
      failed++;
      done++;
      console.log(`  [${done}/${files.length}] SKIP (unreadable) ${path.relative(root, file)}`);
      continue;
    }

    const sourceWidth = meta.width ?? Number.MAX_SAFE_INTEGER;
    let madeForThis = 0;

    for (const format of ['avif', 'webp'] as const) {
      for (const width of WIDTHS[format]) {
        if (width > sourceWidth * 1.05) continue;
        try {
          const before = Date.now();
          const out = await getDerivative(file, {
            width,
            format,
            quality: QUALITY_DEFAULTS[format],
            fast: false, // nobody is waiting — always use best compression
          });
          const size = fs.statSync(out).size;
          derivativeBytes += size;
          if (Date.now() - before < 5) skipped++;
          else { generated++; madeForThis++; }
        } catch (error) {
          failed++;
          logger.warn(`Failed ${format}@${width} for ${file}: ${(error as Error).message}`);
        }
      }
    }

    await getLqip(file);
    done++;

    const pct = ((done / files.length) * 100).toFixed(0);
    console.log(
      `  [${done}/${files.length}] ${pct.padStart(3)}%  ${madeForThis} new  ${path.relative(root, file)}`
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n─────────────────────────────────────────────');
  console.log(`  Sources processed : ${files.length}`);
  console.log(`  Derivatives made  : ${generated}`);
  console.log(`  Already cached    : ${skipped}`);
  console.log(`  Failures          : ${failed}`);
  console.log(`  Cache size        : ${mb(derivativeBytes)}`);
  console.log(`  Elapsed           : ${elapsed}s`);
  console.log('─────────────────────────────────────────────\n');

  // The pipeline queues background work via setImmediate; give it a moment to
  // settle so the process does not exit mid-write.
  await new Promise((r) => setTimeout(r, 500));
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  logger.error('Warm-up failed:', error);
  process.exit(1);
});

// Referenced so the import is not tree-shaken in transpile-only mode.
void RESPONSIVE_WIDTHS;
