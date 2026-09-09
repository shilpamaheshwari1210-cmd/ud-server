/**
 * Gender-demo seed — run once:
 *   npx ts-node --transpile-only src/scripts/seedGenderDemo.ts
 *
 * Creates:
 *   - 4 MEN products, 4 WOMEN products, 2 UNISEX products
 *   - 5 banners  (2 MEN, 2 WOMEN, 1 ALL)
 *
 * Safe to re-run — skips products/banners that already exist (by slug/title).
 */

import { PrismaClient, BannerType } from '@prisma/client';

const prisma = new PrismaClient();

// ─── helpers ──────────────────────────────────────────────────────────────────
const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// picsum.photos returns a deterministic image for every seed string
const productImg = (seed: string) =>
  `https://picsum.photos/seed/${seed}/400/500`;

const bannerImg = (seed: string) =>
  `https://picsum.photos/seed/${seed}/1440/560`;

// ─── product definitions ───────────────────────────────────────────────────────
const PRODUCTS = [
  // ── MEN (4) ────────────────────────────────────────────────────────────────
  {
    name: 'Classic Graphic Tee',
    categorySlug: 't-shirts',
    gender: 'MEN',
    basePrice: 799,
    salePrice: 599,
    stockQuantity: 50,
    shortDesc: 'Bold graphic print on 100% premium cotton. A wardrobe essential for every man.',
    description: 'Cut from heavyweight 100% ring-spun cotton, this classic crew-neck tee features an original graphic print. Pre-shrunk, so it keeps its shape wash after wash.',
    isFeatured: true,
    isTrending: false,
    isNewArrival: true,
    isBestSeller: false,
    imgSeed: 'men-tee-graphic',
  },
  {
    name: 'Utility Cargo Pants',
    categorySlug: 'cargo-pants',
    gender: 'MEN',
    basePrice: 1599,
    salePrice: 1299,
    stockQuantity: 35,
    shortDesc: 'Multi-pocket cargo pants built for style and function.',
    description: 'Six deep pockets, a relaxed fit through the thigh, and a tapered leg make these the ultimate utility pants. Ripstop cotton canvas keeps them durable all day.',
    isFeatured: false,
    isTrending: true,
    isNewArrival: false,
    isBestSeller: true,
    imgSeed: 'men-cargo-pants',
  },
  {
    name: 'Premium Oversized Hoodie',
    categorySlug: 'hoodies-sweatshirts',
    gender: 'MEN',
    basePrice: 1899,
    salePrice: 1499,
    stockQuantity: 40,
    shortDesc: 'Heavy-weight fleece hoodie with a relaxed drop-shoulder fit.',
    description: 'Crafted from 380 GSM French terry fleece, this hoodie is built for serious comfort. Features a kangaroo pocket, ribbed cuffs and hem, and an oversized boxy silhouette.',
    isFeatured: true,
    isTrending: false,
    isNewArrival: false,
    isBestSeller: true,
    imgSeed: 'men-hoodie-premium',
  },
  {
    name: 'Urban Streetwear Co-ord',
    categorySlug: 'streetwear',
    gender: 'MEN',
    basePrice: 2199,
    salePrice: 1799,
    stockQuantity: 25,
    shortDesc: 'Matching jacket + jogger set made for the streets.',
    description: 'A head-to-toe street look in a single buy. The zip-up jacket and joggers share the same tech-twill fabric and tonal branding — wear together or mix into your rotation.',
    isFeatured: true,
    isTrending: true,
    isNewArrival: true,
    isBestSeller: false,
    imgSeed: 'men-streetwear-coord',
  },

  // ── WOMEN (4) ──────────────────────────────────────────────────────────────
  {
    name: 'Floral Wrap Dress',
    categorySlug: 'dresses',
    gender: 'WOMEN',
    basePrice: 1399,
    salePrice: 1099,
    stockQuantity: 45,
    shortDesc: 'Elegant floral wrap dress with a flattering A-line silhouette.',
    description: 'Made from lightweight chiffon, this midi wrap dress features a tie-waist belt, V-neckline, and an all-over floral print. Perfect for brunches, events, or a day out.',
    isFeatured: true,
    isTrending: false,
    isNewArrival: true,
    isBestSeller: false,
    imgSeed: 'women-floral-dress',
  },
  {
    name: 'Pastel Co-ord Set',
    categorySlug: 'co-ord-sets',
    gender: 'WOMEN',
    basePrice: 1799,
    salePrice: 1499,
    stockQuantity: 30,
    shortDesc: 'Soft pastel matching set — crop top and wide-leg trousers.',
    description: 'This breezy matching set is made from breathable cotton-linen blend. The crop top has adjustable spaghetti straps and a square neck; the wide-leg trousers have an elasticated waist.',
    isFeatured: true,
    isTrending: true,
    isNewArrival: false,
    isBestSeller: true,
    imgSeed: 'women-pastel-coord',
  },
  {
    name: 'Everyday Ribbed Crop Top',
    categorySlug: 'tops',
    gender: 'WOMEN',
    basePrice: 699,
    salePrice: 499,
    stockQuantity: 60,
    shortDesc: 'Stretchy ribbed cotton crop top for effortless everyday style.',
    description: 'A go-to crop top in medium-weight ribbed cotton. The slim fit, round neckline, and short-length cut make it incredibly versatile — tuck into jeans, layer under blazers, or wear with skirts.',
    isFeatured: false,
    isTrending: true,
    isNewArrival: true,
    isBestSeller: false,
    imgSeed: 'women-ribbed-crop',
  },
  {
    name: 'Boho Printed Maxi Dress',
    categorySlug: 'dresses',
    gender: 'WOMEN',
    basePrice: 1599,
    salePrice: 1299,
    stockQuantity: 28,
    shortDesc: 'Relaxed bohemian maxi dress with an abstract print and flowy fit.',
    description: 'Flowing georgette fabric, a smocked back panel for stretch, and a handkerchief hem that moves beautifully. The abstract Boho print makes every outfit effortlessly artistic.',
    isFeatured: false,
    isTrending: true,
    isNewArrival: false,
    isBestSeller: true,
    imgSeed: 'women-boho-maxi',
  },

  // ── UNISEX (2) ─────────────────────────────────────────────────────────────
  {
    name: 'Unisex Oversized Drop Tee',
    categorySlug: 'oversized-t-shirts',
    gender: 'UNISEX',
    basePrice: 999,
    salePrice: 799,
    stockQuantity: 70,
    shortDesc: 'Boxy drop-shoulder tee that looks great on everyone.',
    description: 'A true unisex oversized tee cut from 240 GSM slub cotton. The dropped shoulders, wide body, and subtle tonal branding create a clean, contemporary look regardless of your wardrobe.',
    isFeatured: true,
    isTrending: true,
    isNewArrival: true,
    isBestSeller: false,
    imgSeed: 'unisex-oversized-tee',
  },
  {
    name: 'Statement Canvas Tote',
    categorySlug: 'accessories',
    gender: 'UNISEX',
    basePrice: 599,
    salePrice: 399,
    stockQuantity: 100,
    shortDesc: 'Heavy-duty canvas tote with a bold printed slogan.',
    description: 'Made from 12 oz natural canvas with reinforced stitching and extended handles that fit over the shoulder. The bold slogan print is screen-printed with water-based inks that stay sharp wash after wash.',
    isFeatured: false,
    isTrending: false,
    isNewArrival: true,
    isBestSeller: false,
    imgSeed: 'unisex-canvas-tote',
  },
];

// ─── banner definitions ────────────────────────────────────────────────────────
const BANNERS = [
  // MEN (2)
  {
    title: "New Men's Collection",
    subtitle: 'Freshest drops for the modern man',
    gender: 'MEN',
    ctaText: 'Shop Men',
    link: '/shop?gender=MEN',
    sortOrder: 3,
    imgSeed: 'banner-men-collection',
  },
  {
    title: "Men's Streetwear Drop",
    subtitle: 'Street-ready styles — limited stock',
    gender: 'MEN',
    ctaText: 'Explore Streetwear',
    link: '/shop?gender=MEN&category=streetwear',
    sortOrder: 4,
    imgSeed: 'banner-men-streetwear',
  },
  // WOMEN (2)
  {
    title: "Women's Summer Edit",
    subtitle: 'Light, breezy & effortlessly stylish',
    gender: 'WOMEN',
    ctaText: 'Shop Women',
    link: '/shop?gender=WOMEN',
    sortOrder: 5,
    imgSeed: 'banner-women-summer',
  },
  {
    title: 'New Dresses & Co-ords',
    subtitle: 'Your next favourite outfit is here',
    gender: 'WOMEN',
    ctaText: 'Discover Now',
    link: '/shop?gender=WOMEN&category=dresses',
    sortOrder: 6,
    imgSeed: 'banner-women-dresses',
  },
  // ALL / UNISEX (1)
  {
    title: 'Style for Everyone',
    subtitle: 'Unisex essentials — made for all',
    gender: 'ALL',
    ctaText: 'Shop All',
    link: '/shop',
    sortOrder: 7,
    imgSeed: 'banner-all-unisex',
  },
];

// ─── seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('🌱  Starting gender-demo seed…\n');

  // 1. Ensure categories exist (they should from server.ts init)
  const allCategories = await prisma.category.findMany({
    select: { id: true, slug: true },
  });
  const catBySlug: Record<string, string> = {};
  for (const c of allCategories) catBySlug[c.slug] = c.id;

  // ── Products ──────────────────────────────────────────────────────────────
  let productsCreated = 0;
  let productsSkipped = 0;

  for (const p of PRODUCTS) {
    const slug = toSlug(p.name);
    const exists = await prisma.product.findUnique({ where: { slug } });
    if (exists) { productsSkipped++; continue; }

    const categoryId = catBySlug[p.categorySlug];
    if (!categoryId) {
      console.warn(`  ⚠  Category "${p.categorySlug}" not found — skipping "${p.name}"`);
      continue;
    }

    const product = await prisma.product.create({
      data: {
        name: p.name,
        slug,
        shortDesc: p.shortDesc,
        description: p.description,
        categoryId,
        gender: p.gender,
        basePrice: p.basePrice,
        salePrice: p.salePrice,
        stockQuantity: p.stockQuantity,
        isActive: true,
        isFeatured: p.isFeatured,
        isTrending: p.isTrending,
        isNewArrival: p.isNewArrival,
        isBestSeller: p.isBestSeller,
        sortOrder: 0,
        images: {
          create: {
            url: productImg(p.imgSeed),
            altText: p.name,
            isPrimary: true,
            sortOrder: 0,
          },
        },
      },
    });

    console.log(`  ✅  [${p.gender.padEnd(6)}] Product: ${product.name}`);
    productsCreated++;
  }

  console.log(`\n  Products → created: ${productsCreated}, skipped: ${productsSkipped}\n`);

  // ── Banners ───────────────────────────────────────────────────────────────
  let bannersCreated = 0;
  let bannersSkipped = 0;

  for (const b of BANNERS) {
    const exists = await prisma.banner.findFirst({ where: { title: b.title } });
    if (exists) { bannersSkipped++; continue; }

    const banner = await prisma.banner.create({
      data: {
        title: b.title,
        subtitle: b.subtitle,
        image: bannerImg(b.imgSeed),
        type: BannerType.HERO,
        gender: b.gender,
        ctaText: b.ctaText,
        link: b.link,
        isActive: true,
        sortOrder: b.sortOrder,
      },
    });

    console.log(`  ✅  [${b.gender.padEnd(6)}] Banner:  ${banner.title}`);
    bannersCreated++;
  }

  console.log(`\n  Banners → created: ${bannersCreated}, skipped: ${bannersSkipped}\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const productStats = await prisma.product.groupBy({
    by: ['gender'],
    _count: { id: true },
    where: { deletedAt: null },
  });

  const bannerStats = await prisma.banner.groupBy({
    by: ['gender'],
    _count: { id: true },
  });

  console.log('📊  Current product counts by gender:');
  for (const s of productStats) {
    console.log(`     ${s.gender.padEnd(8)} → ${s._count.id} products`);
  }

  console.log('\n📊  Current banner counts by gender:');
  for (const s of bannerStats) {
    console.log(`     ${s.gender.padEnd(8)} → ${s._count.id} banners`);
  }

  console.log('\n✨  Seed complete.\n');
}

seed()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
