/**
 * Import a Shopify product CSV export into this catalogue.
 *
 *   npx ts-node --transpile-only src/scripts/importShopify.ts <file.csv> [options]
 *
 * Options
 *   --dry-run            Parse, map and report. Writes nothing, downloads nothing.
 *   --limit=N            Only process the first N products (useful for a trial run).
 *   --gender=WOMEN       Gender applied to every imported product (default UNISEX).
 *   --skip-images        Create products without downloading images.
 *   --update-existing    Update products whose slug already exists (default: skip).
 *   --draft              Import everything inactive so you can review before publishing.
 *
 * How to produce the CSV:
 *   Shopify admin -> Products -> Export -> "All products" -> "Plain CSV file".
 *   Shopify emails it or downloads it directly.
 *
 * Shape of a Shopify export, which drives most of the logic below:
 *   - One ROW PER VARIANT, not per product.
 *   - Product-level columns (Title, Body, Type, Tags...) appear ONLY on the
 *     first row of each Handle; later rows leave them blank.
 *   - Extra images get their own rows carrying just Handle + Image Src.
 *   So rows must be grouped by Handle and folded together.
 *
 * Safe to re-run: products are matched by slug (Shopify's Handle) and skipped
 * unless --update-existing is passed. Images already on disk are not
 * re-downloaded.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { config } from '../config/env';
import { parseCsvToObjects } from '../utils/csv';
import { createSlug } from '../utils/slugify';
import { getImageUrl } from '../utils/upload';
import { readImageMetadata, MIN_SOURCE_WIDTH } from '../utils/imagePipeline';

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const csvPath = argv.find(a => !a.startsWith('--'));
const has = (f: string) => argv.includes(f);
const val = (f: string) => argv.find(a => a.startsWith(`${f}=`))?.split('=')[1];

/**
 * Live-store source. A Shopify storefront exposes /products.json publicly, so
 * the catalogue can be pulled without admin credentials or a manual export.
 *
 * Trade-off vs the CSV export: the public feed carries no inventory counts
 * (only a boolean `available`) and omits unpublished products. Use the admin
 * CSV when exact stock matters.
 */
const STORE = val('--store');
const STOCK_FOR_AVAILABLE = parseInt(val('--stock-available') || '10', 10);

const DRY_RUN = has('--dry-run');
const SKIP_IMAGES = has('--skip-images');
const UPDATE_EXISTING = has('--update-existing');
const AS_DRAFT = has('--draft');
const LIMIT = val('--limit') ? parseInt(val('--limit')!, 10) : Infinity;
const GENDER = (val('--gender') || 'UNISEX').toUpperCase();

// ── Shopify row → grouped product ────────────────────────────────────────────
interface ShopifyVariant {
  sku: string;
  size?: string;
  color?: string;
  material?: string;
  price: number | null;
  compareAt: number | null;
  stock: number;
  grams: number;
  imageSrc?: string;
}

interface ShopifyProduct {
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  type: string;
  tags: string[];
  published: boolean;
  status: string;
  seoTitle: string;
  seoDescription: string;
  images: { src: string; position: number; alt: string; width?: number }[];
  variants: ShopifyVariant[];
}

const num = (v: string): number | null => {
  if (v === undefined || v === null || v.trim() === '') return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Assign a Shopify option to the right variant field.
 * Shopify stores options positionally (Option1/2/3) with a free-text NAME, so
 * "Size" might be option 1 on one product and option 2 on another.
 */
const applyOption = (variant: ShopifyVariant, name: string, value: string) => {
  if (!name || !value) return;
  const n = name.trim().toLowerCase();
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'default title') return;

  if (n.includes('size')) variant.size = v;
  else if (n.includes('colour') || n.includes('color')) variant.color = v;
  else if (n.includes('material') || n.includes('fabric')) variant.material = v;
  // Unknown option name — fill whichever slot is still free rather than drop it.
  else if (!variant.size) variant.size = v;
  else if (!variant.color) variant.color = v;
  else if (!variant.material) variant.material = v;
};

const groupRows = (rows: Record<string, string>[]): ShopifyProduct[] => {
  const byHandle = new Map<string, ShopifyProduct>();

  for (const r of rows) {
    const handle = r['Handle'];
    if (!handle) continue;

    let p = byHandle.get(handle);
    if (!p) {
      p = {
        handle,
        title: '',
        bodyHtml: '',
        vendor: '',
        type: '',
        tags: [],
        published: true,
        status: 'active',
        seoTitle: '',
        seoDescription: '',
        images: [],
        variants: [],
      };
      byHandle.set(handle, p);
    }

    // Product-level fields only appear on the handle's first row.
    if (r['Title']) p.title = r['Title'];
    if (r['Body (HTML)']) p.bodyHtml = r['Body (HTML)'];
    if (r['Vendor']) p.vendor = r['Vendor'];
    if (r['Type']) p.type = r['Type'];
    if (r['Tags']) p.tags = r['Tags'].split(',').map(t => t.trim()).filter(Boolean);
    if (r['Published']) p.published = r['Published'].toUpperCase() === 'TRUE';
    if (r['Status']) p.status = r['Status'].toLowerCase();
    if (r['SEO Title']) p.seoTitle = r['SEO Title'];
    if (r['SEO Description']) p.seoDescription = r['SEO Description'];

    // Image rows: a handle's extra images arrive as their own rows.
    const imgSrc = r['Image Src'];
    if (imgSrc && !p.images.some(i => i.src === imgSrc)) {
      p.images.push({
        src: imgSrc,
        position: num(r['Image Position']) ?? p.images.length + 1,
        alt: r['Image Alt Text'] || '',
      });
    }

    // A variant row is one that carries pricing or a SKU. Pure image rows have
    // neither and must not create an empty variant.
    const hasVariant = !!(r['Variant SKU'] || r['Variant Price'] || r['Option1 Value']);
    if (hasVariant) {
      const v: ShopifyVariant = {
        sku: r['Variant SKU'] || '',
        price: num(r['Variant Price']),
        compareAt: num(r['Variant Compare At Price']),
        stock: num(r['Variant Inventory Qty']) ?? 0,
        grams: num(r['Variant Grams']) ?? 0,
        imageSrc: r['Variant Image'] || undefined,
      };
      applyOption(v, r['Option1 Name'], r['Option1 Value']);
      applyOption(v, r['Option2 Name'], r['Option2 Value']);
      applyOption(v, r['Option3 Name'], r['Option3 Value']);
      p.variants.push(v);
    }
  }

  return [...byHandle.values()];
};

// ── Live store source (public /products.json) ────────────────────────────────

/** Fetch every published product from a storefront, following pagination. */
const fetchStoreProducts = async (store: string): Promise<ShopifyProduct[]> => {
  const host = store.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const out: ShopifyProduct[] = [];

  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`https://${host}/products.json?limit=250&page=${page}`);
    if (!res.ok) throw new Error(`${host} returned ${res.status} — is the store public?`);
    const body = (await res.json()) as { products?: any[] };
    const batch = body.products ?? [];
    if (batch.length === 0) break;

    for (const p of batch) {
      const variants: ShopifyVariant[] = (p.variants ?? []).map((v: any) => {
        const variant: ShopifyVariant = {
          sku: v.sku || '',
          price: v.price !== undefined && v.price !== null ? Number(v.price) : null,
          compareAt: v.compare_at_price ? Number(v.compare_at_price) : null,
          // The public feed has no inventory count, only availability, so an
          // in-stock variant gets a uniform placeholder the admin can correct.
          stock: v.available ? STOCK_FOR_AVAILABLE : 0,
          grams: Number(v.grams) || 0,
          imageSrc: v.featured_image?.src,
        };
        // Options are positional here too, named by the product's `options`.
        (p.options ?? []).forEach((opt: any, i: number) => {
          applyOption(variant, opt.name, v[`option${i + 1}`]);
        });
        return variant;
      });

      out.push({
        handle: p.handle,
        title: p.title || '',
        bodyHtml: p.body_html || '',
        vendor: p.vendor || '',
        type: p.product_type || '',
        tags: (p.tags ?? []).map((t: any) => String(t).trim()).filter(Boolean),
        published: true, // /products.json only lists published products
        status: 'active',
        seoTitle: '',
        seoDescription: '',
        images: (p.images ?? []).map((im: any, i: number) => ({
          src: im.src,
          position: im.position ?? i + 1,
          alt: im.alt || '',
          // Known up-front from the feed, so low-resolution sources can be
          // reported without downloading them first.
          width: im.width as number | undefined,
        })),
        variants,
      });
    }

    if (batch.length < 250) break;
  }

  return out;
};

/**
 * Derive a category from tags, because this export has product_type empty on
 * every product. Ordered most-specific first: a "tshirt" also tagged "top"
 * should land in T-Shirts, not Tops.
 */
const TAG_CATEGORY: [RegExp, string][] = [
  [/^babe ?tee$|^tshirt$|^t-shirt$/i, 'T-Shirts'],
  [/^coord$|^co-ord$/i, 'Co-ord Sets'],
  [/^denim$|^jeans$/i, 'Denim'],
  [/^dress(es)?$/i, 'Dresses'],
  [/^cargo$/i, 'Cargo Pants'],
  [/^pants?$|^trousers?$/i, 'Pants'],
  [/^skirts?$/i, 'Skirts'],
  [/^shorts$/i, 'Shorts'],
  [/^shirts?$/i, 'Shirts'],
  [/^bags?$/i, 'Accessories'],
  [/^tops?$/i, 'Tops'],
];

const categoryFromTags = (tags: string[]): string => {
  for (const [pattern, category] of TAG_CATEGORY) {
    if (tags.some(t => pattern.test(t.trim()))) return category;
  }
  return 'Imported';
};

// ── Image download ───────────────────────────────────────────────────────────

/**
 * Shopify CDN URLs often carry a size modifier before the extension
 * (`shirt_600x800.jpg`, `shirt_1024x.jpg`). Those are downscaled renditions.
 * Stripping the modifier yields the master upload, which is what we want —
 * this catalogue serves resized derivatives of its own and a small source
 * cannot be recovered later.
 */
export const toOriginalShopifyUrl = (url: string): string => {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/_(?:\d+x\d*|x\d+)(?=\.[a-z]+$)/i, '');
    // `v=` is a cache-buster, harmless to keep; drop display params.
    u.searchParams.delete('width');
    u.searchParams.delete('height');
    return u.toString();
  } catch {
    return url;
  }
};

const downloadImage = async (url: string, destDir: string): Promise<string | null> => {
  const original = toOriginalShopifyUrl(url);
  try {
    const res = await fetch(original, { redirect: 'follow' });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;

    const ext =
      type.includes('png') ? '.png' :
      type.includes('webp') ? '.webp' :
      type.includes('avif') ? '.avif' :
      '.jpg';

    const buf = Buffer.from(await res.arrayBuffer());

    // Name by content hash so re-running never duplicates the same photo and a
    // partially-completed import resumes cleanly.
    const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 32) + ext;
    const dest = path.join(destDir, name);

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(destDir, { recursive: true });
      // temp + rename so an interrupted run cannot leave a truncated image
      const tmp = `${dest}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, dest);
    }
    return dest;
  } catch {
    return null;
  }
};

// ── Category resolution ──────────────────────────────────────────────────────
const categoryCache = new Map<string, string>();

/**
 * Whether the database answered on startup. A dry run is most useful for
 * validating a CSV *before* going anywhere near production, so it must not
 * require a reachable database — it simply cannot report which products are
 * already imported when there is none.
 */
let dbAvailable = false;

const resolveCategory = async (typeName: string): Promise<string | null> => {
  const name = (typeName || '').trim() || 'Uncategorised';
  const slug = createSlug(name);

  const cached = categoryCache.get(slug);
  if (cached) return cached;

  if (!dbAvailable) return 'dry-run-no-db';

  let cat = await prisma.category.findUnique({ where: { slug } });
  if (!cat && !DRY_RUN) {
    cat = await prisma.category.create({
      data: {
        name,
        slug,
        isActive: true,
        showInNav: true,
        gender: GENDER === 'UNISEX' ? null : GENDER,
        metaTitle: `${name} | Unique Dressup`,
      },
    });
  }
  if (cat) categoryCache.set(slug, cat.id);
  return cat?.id ?? null;
};

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!csvPath && !STORE) {
    console.error('\n  Usage: importShopify.ts <export.csv> | --store=shop.myshopify.com  [--dry-run] [--limit=N] [--gender=WOMEN]\n');
    process.exit(1);
  }
  if (csvPath && !fs.existsSync(csvPath)) {
    console.error(`\n  File not found: ${csvPath}\n`);
    process.exit(1);
  }

  let rowCount = 0;
  let products: ShopifyProduct[];
  if (STORE) {
    console.log(`\n  Fetching catalogue from ${STORE} ...`);
    products = await fetchStoreProducts(STORE);
    rowCount = products.length;
  } else {
    const rows = parseCsvToObjects(fs.readFileSync(csvPath!, 'utf8'));
    rowCount = rows.length;
    products = groupRows(rows);
  }
  products = products.slice(0, LIMIT);

  try {
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    if (!DRY_RUN) {
      console.error('\n  Cannot reach the database. Fix DATABASE_URL, or use --dry-run to validate the CSV offline.\n');
      process.exit(1);
    }
    console.log('\n  (no database reachable — validating the file only; cannot report duplicates)');
  }

  console.log(`\n  Shopify import${DRY_RUN ? '  [DRY RUN — nothing will be written]' : ''}`);
  console.log('  ' + '─'.repeat(78));
  console.log(`  source          : ${STORE ? STORE + ' (public /products.json)' : path.basename(csvPath!)}`);
  console.log(`  records         : ${rowCount}`);
  console.log(`  products found  : ${products.length}`);
  console.log(`  gender          : ${GENDER}`);
  console.log(`  images          : ${SKIP_IMAGES ? 'skipped' : 'downloaded'}`);
  console.log(`  existing slugs  : ${UPDATE_EXISTING ? 'update' : 'skip'}`);
  console.log('  ' + '─'.repeat(78));

  const uploadDir = path.join(path.resolve(config.upload.path), 'products');
  const stats = {
    created: 0, updated: 0, skipped: 0, failed: 0,
    images: 0, imagesFailed: 0, lowRes: 0, variants: 0,
  };
  const lowResNotes: string[] = [];

  for (const [idx, p] of products.entries()) {
    // Some handles are auto-generated (untitled-jul15_18-06-20) and make
    // meaningless URLs, so prefer the title and keep the handle as fallback.
    const slug = /^(untitled|copy-of)|_\d{2}-\d{2}-\d{2}/.test(p.handle)
      ? createSlug(p.title || p.handle)
      : createSlug(p.handle || p.title);
    const label = `[${idx + 1}/${products.length}] ${p.title.slice(0, 44)}`;

    if (!p.title) { stats.skipped++; console.log(`  ${label} — SKIP (no title)`); continue; }

    const existing = dbAvailable ? await prisma.product.findUnique({ where: { slug } }) : null;
    if (existing && !UPDATE_EXISTING) {
      stats.skipped++;
      console.log(`  ${label} — SKIP (already imported)`);
      continue;
    }

    // Price: Shopify's "Price" is what the customer pays and "Compare At" is
    // the struck-through was-price. This catalogue stores basePrice as the
    // higher figure with salePrice as the discount, so the two swap.
    const first = p.variants[0];
    const price = first?.price ?? 0;
    const compareAt = first?.compareAt ?? null;
    const basePrice = compareAt && compareAt > price ? compareAt : price;
    const salePrice = compareAt && compareAt > price ? price : null;

    const totalStock = p.variants.reduce((s, v) => s + (v.stock || 0), 0);

    // Images
    const imageRecords: { url: string; altText: string; sortOrder: number; isPrimary: boolean }[] = [];
    if (!SKIP_IMAGES && !DRY_RUN) {
      const ordered = [...p.images].sort((a, b) => a.position - b.position);
      for (const [i, img] of ordered.entries()) {
        const diskPath = await downloadImage(img.src, uploadDir);
        if (!diskPath) { stats.imagesFailed++; continue; }

        const meta = await readImageMetadata(diskPath);
        const minW = MIN_SOURCE_WIDTH.products ?? 0;
        if (meta?.width && meta.width < minW) {
          stats.lowRes++;
          lowResNotes.push(`${p.title.slice(0, 34)} — ${meta.width}x${meta.height} (needs ${minW}px)`);
        }

        // getImageUrl also schedules derivative pre-warming for this file.
        imageRecords.push({
          url: getImageUrl(diskPath),
          altText: img.alt || p.title,
          sortOrder: i,
          isPrimary: i === 0,
        });
        stats.images++;
      }
    }

    // product_type is blank on every product in this export, so the
    // garment-type tag decides the category.
    const categoryName = (p.type || '').trim() || categoryFromTags(p.tags);
    const categoryId = await resolveCategory(categoryName);
    if (!categoryId && !DRY_RUN) {
      stats.failed++;
      console.log(`  ${label} — FAIL (no category)`);
      continue;
    }

    const variantData = p.variants
      .filter(v => v.size || v.color || v.material)
      .map((v, i) => ({
        sku: v.sku || null,
        size: v.size || null,
        color: v.color || null,
        material: v.material || null,
        price: v.price ?? null,
        stockQuantity: v.stock || 0,
        isActive: true,
        sortOrder: i,
      }));

    const isActive = AS_DRAFT ? false : p.published && p.status === 'active';

    const data = {
      name: p.title,
      slug,
      description: p.bodyHtml || null,
      brand: p.vendor || null,
      sku: first?.sku || null,
      basePrice,
      salePrice,
      stockQuantity: totalStock,
      weight: first?.grams ? first.grams / 1000 : null,
      isActive,
      isNewArrival: true,
      gender: GENDER,
      metaTitle: p.seoTitle || null,
      metaDesc: p.seoDescription || null,
    };

    if (DRY_RUN) {
      stats.created++;
      console.log(
        `  ${label} — would import: ${p.variants.length} variant(s), ${p.images.length} image(s), ` +
        `₹${basePrice}${salePrice ? ` → ₹${salePrice}` : ''}, stock ${totalStock}, category "${categoryName}"`
      );
      continue;
    }

    try {
      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            ...data,
            categoryId: categoryId!,
            ...(imageRecords.length && { images: { deleteMany: {}, create: imageRecords } }),
            ...(variantData.length && { variants: { deleteMany: {}, create: variantData } }),
            tags: { deleteMany: {}, create: p.tags.map(tag => ({ tag })) },
          },
        });
        stats.updated++;
        console.log(`  ${label} — UPDATED`);
      } else {
        await prisma.product.create({
          data: {
            ...data,
            category: { connect: { id: categoryId! } },
            images: imageRecords.length ? { create: imageRecords } : undefined,
            variants: variantData.length ? { create: variantData } : undefined,
            tags: p.tags.length ? { create: p.tags.map(tag => ({ tag })) } : undefined,
          },
        });
        stats.created++;
        console.log(`  ${label} — CREATED (${variantData.length} variants, ${imageRecords.length} images)`);
      }
      stats.variants += variantData.length;
    } catch (err) {
      stats.failed++;
      console.log(`  ${label} — FAIL: ${(err as Error).message.split('\n')[0].slice(0, 90)}`);
    }
  }

  console.log('  ' + '─'.repeat(78));
  console.log(`  created ${stats.created}   updated ${stats.updated}   skipped ${stats.skipped}   failed ${stats.failed}`);
  console.log(`  variants ${stats.variants}   images ${stats.images} downloaded, ${stats.imagesFailed} failed`);
  if (stats.lowRes) {
    console.log(`\n  ${stats.lowRes} image(s) below the clarity minimum — these will look soft:`);
    lowResNotes.slice(0, 10).forEach(n => console.log(`    ${n}`));
    if (lowResNotes.length > 10) console.log(`    ...and ${lowResNotes.length - 10} more`);
  }
  console.log('  ' + '─'.repeat(78) + '\n');

  // Derivative pre-warming is queued on setImmediate; give it a moment to start
  // before the process exits.
  await new Promise(r => setTimeout(r, 1000));
  await prisma.$disconnect();
  process.exit(stats.failed > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('\n  Import failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
