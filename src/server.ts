import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import app from './app';
import { config } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { HomepageSectionType, BannerType, CouponType } from '@prisma/client';

const PORT = config.port;

// ── helpers ───────────────────────────────────────────────────────────────────
const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── initial data ──────────────────────────────────────────────────────────────
// All blocks use createMany({ skipDuplicates: true }) or a count-guard so that
// existing admin edits are NEVER overwritten on restart.

const INIT_SETTINGS = [
  { key: 'site_name',            value: 'Unique Dressup',                                                           group: 'general',  label: 'Site Name' },
  { key: 'site_tagline',         value: 'Express Your Unique Style',                                                group: 'general',  label: 'Tagline' },
  { key: 'site_email',           value: 'uniquedressup@gmail.com',                                                  group: 'general',  label: 'Support Email' },
  { key: 'site_description',     value: 'Trendy & affordable fashion for every occasion. Explore kurtas, co-ords, dresses, and more.', group: 'general', label: 'Site Description' },
  // Trimmed, transparent wordmark (600x333). The old /logo.jpg was a 4500x4500
  // square with ~60% white padding, which forced a 1:1 render everywhere.
  { key: 'logo_url',             value: '/logo-mark.png',                                                           group: 'general',  label: 'Logo URL' },
  // Light colourway for dark surfaces (footer).
  { key: 'logo_url_light',       value: '/logo-mark-light.png',                                                     group: 'general',  label: 'Logo URL (light, for dark backgrounds)' },
  { key: 'currency',             value: 'INR',                                                                      group: 'general',  label: 'Currency Code' },
  { key: 'currency_symbol',      value: '₹',                                                                        group: 'general',  label: 'Currency Symbol' },
  { key: 'site_phone',           value: '+91 98765 43210',                                                          group: 'contact',  label: 'Phone' },
  { key: 'site_address',         value: 'India',                                                                    group: 'contact',  label: 'Address' },
  { key: 'contact_hours',        value: 'Mon – Sat: 10:00 AM – 7:00 PM',                                            group: 'contact',  label: 'Business Hours' },
  { key: 'instagram_url',        value: '',                                                                         group: 'social',   label: 'Instagram URL' },
  { key: 'facebook_url',         value: '',                                                                         group: 'social',   label: 'Facebook URL' },
  { key: 'twitter_url',          value: '',                                                                         group: 'social',   label: 'Twitter / X URL' },
  { key: 'youtube_url',          value: '',                                                                         group: 'social',   label: 'YouTube URL' },
  { key: 'pinterest_url',        value: '',                                                                         group: 'social',   label: 'Pinterest URL' },
  { key: 'announcement_text',    value: 'FREE SHIPPING ON ORDERS ABOVE ₹999 | USE CODE: WELCOME10 FOR 10% OFF',    group: 'homepage', label: 'Announcement Bar' },
  { key: 'free_shipping_threshold', value: '999',                                                                   group: 'shipping', label: 'Free Shipping Threshold' },
  { key: 'standard_shipping_rate',  value: '99',                                                                    group: 'shipping', label: 'Standard Shipping Rate' },
  { key: 'express_shipping_rate',   value: '149',                                                                   group: 'shipping', label: 'Express Shipping Rate' },
  { key: 'self_delivery_pincodes',  value: '',                                                                      group: 'shipping', label: 'Self-Delivery Pincodes' },
];

const INIT_CATEGORIES = [
  { name: 'T-Shirts',              desc: 'Premium graphic and plain tees',          featured: true },
  { name: 'Oversized T-Shirts',    desc: 'Trendy oversized fits',                   featured: true },
  { name: 'Cargo Pants',           desc: 'Functional multi-pocket bottoms',         featured: true },
  { name: 'Co-ord Sets',           desc: 'Matching top and bottom sets',            featured: true },
  { name: 'Dresses',               desc: 'Elegant and casual dresses',              featured: true },
  { name: 'Hoodies & Sweatshirts', desc: 'Premium hooded comfort wear',             featured: true },
  { name: 'Denim',                 desc: 'Classic and trendy denim pieces',         featured: false },
  { name: 'Tops',                  desc: 'Versatile everyday tops',                 featured: false },
  { name: 'Accessories',           desc: 'Fashion-forward accessories',             featured: false },
  { name: 'Streetwear',            desc: 'Urban street fashion',                    featured: true },
];

const INIT_COLLECTIONS = [
  { name: 'Summer Essentials', desc: 'Light, breezy pieces for the warm season' },
  { name: 'Street Ready',      desc: 'Bold urban looks for the streets' },
  { name: 'Office Chic',       desc: 'Professional looks with a twist' },
  { name: 'Festival Looks',    desc: 'Stand out at any festival' },
  { name: 'Night Out',         desc: 'Perfect for evenings and parties' },
];

const INIT_HOMEPAGE_SECTIONS = [
  { type: 'HERO_SLIDER',          title: 'Hero Slider',         isActive: true, sortOrder: 1 },
  { type: 'PROMOTIONAL_BANNERS',  title: 'Promotional Banners', isActive: true, sortOrder: 2 },
  { type: 'NEW_ARRIVALS',         title: 'New Arrivals',        subtitle: 'Fresh Drops',              isActive: true, sortOrder: 3, config: { limit: 8 } },
  { type: 'FEATURED_CATEGORIES',  title: 'Shop by Category',    isActive: true, sortOrder: 4 },
  { type: 'TRENDING_PRODUCTS',    title: 'Trending Now',        subtitle: "Everyone's Talking About", isActive: true, sortOrder: 5, config: { limit: 8 } },
  { type: 'BEST_SELLERS',         title: 'Best Sellers',        subtitle: 'Fan Favourites',           isActive: true, sortOrder: 6, config: { limit: 8 } },
  { type: 'TESTIMONIALS',         title: 'What Customers Say',  isActive: true, sortOrder: 7 },
  { type: 'NEWSLETTER',           title: 'Stay in the Loop',    isActive: true, sortOrder: 8 },
];

const INIT_BANNERS = [
  { title: 'New Season Arrivals',       subtitle: 'Discover the latest in premium fashion', image: '/images/placeholder-hero.jpg', type: 'HERO',         isActive: true, sortOrder: 1, ctaText: 'Shop Now',         link: '/shop?isNewArrival=true' },
  { title: 'Trending Styles',           subtitle: 'What everyone is wearing right now',      image: '/images/placeholder-hero.jpg', type: 'HERO',         isActive: true, sortOrder: 2, ctaText: 'Explore Trends',   link: '/shop?isTrending=true' },
  { title: 'Sale — Up to 40% Off',      subtitle: 'Limited time offer',                      image: '/images/placeholder-hero.jpg', type: 'PROMOTIONAL',  isActive: true, sortOrder: 1, ctaText: 'Shop Sale',         link: '/shop?discount=true' },
];

const INIT_TESTIMONIALS = [
  { name: 'Priya Sharma',  rating: 5, review: 'Absolutely love the quality! The fabric feels premium and the fit is perfect. Will definitely order again.',                        designation: 'Fashion Blogger',       sortOrder: 1, isActive: true },
  { name: 'Rahul Verma',   rating: 5, review: "Best fashion store I've shopped from online. Fast delivery and the products look exactly like the photos.",                         designation: 'Regular Customer',      sortOrder: 2, isActive: true },
  { name: 'Ananya Singh',  rating: 4, review: 'Great variety and excellent quality. The co-ord set I ordered is stunning. My friends keep asking where I got it!',                designation: 'Style Enthusiast',      sortOrder: 3, isActive: true },
  { name: 'Kiran Nair',    rating: 5, review: 'The hoodies are worth every penny. Super soft, great fit, and the quality is comparable to premium international brands.',          designation: 'Verified Customer',     sortOrder: 4, isActive: true },
  { name: 'Divya Mehta',   rating: 5, review: 'Received my order in 2 days! The packaging was premium and the dress is absolutely gorgeous. Highly recommend!',                   designation: 'Fashion Lover',         sortOrder: 5, isActive: true },
  { name: 'Rohan Khanna',  rating: 4, review: 'Great streetwear collection. The cargo pants are incredibly well-made and the customer service is top-notch.',                     designation: 'Streetwear Enthusiast', sortOrder: 6, isActive: true },
];

const INIT_COUPONS = [
  { code: 'WELCOME10', type: 'PERCENTAGE',   value: 10,  description: '10% off your first order',   isActive: true, usageLimit: 100 },
  { code: 'FASHION15', type: 'PERCENTAGE',   value: 15,  description: '15% off on all products',    isActive: true, usageLimit: 200, minOrderAmount: 999 },
  { code: 'FLAT200',   type: 'FIXED',        value: 200, description: 'Flat ₹200 off',              isActive: true, usageLimit: 50,  minOrderAmount: 1499 },
  { code: 'FREESHIP',  type: 'FREE_SHIPPING',value: 0,   description: 'Free shipping on any order', isActive: true, usageLimit: 500 },
];

const INIT_SEO = [
  { page: 'home',  metaTitle: 'Unique Dressup — Trendy Fashion Online', metaDesc: 'Shop the latest fashion at Unique Dressup. Explore co-ord sets, dresses, oversized tees, cargo pants and more. Free shipping above ₹999.', robots: 'index, follow' },
  { page: 'shop',  metaTitle: 'Shop All Products | Unique Dressup',     metaDesc: 'Browse our complete collection of trendy fashion. Filter by size, color, price and more.',                                                      robots: 'index, follow' },
  { page: 'blog',  metaTitle: 'Fashion Blog | Unique Dressup',           metaDesc: 'Stay updated with the latest fashion trends, styling tips and outfit inspiration.',                                                             robots: 'index, follow' },
];

const INIT_CMS_PAGES = [
  { title: 'About Us',           slug: 'about',           content: '<h1>About Unique Dressup</h1><p>Unique Dressup is a trendy D2C fashion brand based in India. We bring you affordable, stylish clothing for every occasion — from everyday casuals to special celebrations.</p>',                       isActive: true, showInFooter: false, showInNav: false, sortOrder: 0 },
  { title: 'Privacy Policy',     slug: 'privacy-policy',  content: '<h1>Privacy Policy</h1><p>Your privacy is important to us. This Privacy Policy explains how Unique Dressup collects, uses, and protects your personal information when you use our website and services.</p>',                      isActive: true, showInFooter: true,  showInNav: false, sortOrder: 1 },
  { title: 'Terms & Conditions', slug: 'terms',           content: '<h1>Terms & Conditions</h1><p>By accessing or using Unique Dressup, you agree to be bound by these Terms & Conditions. Please read them carefully before using our services.</p>',                                                  isActive: true, showInFooter: true,  showInNav: false, sortOrder: 2 },
  { title: 'Return Policy',      slug: 'return-policy',   content: '<h1>Return Policy</h1><p>We offer a 7-day hassle-free return policy. Items must be unworn, unwashed, and in original packaging with tags attached.</p>',                                                                           isActive: true, showInFooter: true,  showInNav: false, sortOrder: 3 },
  { title: 'Shipping Policy',    slug: 'shipping-policy', content: '<h1>Shipping Policy</h1><p>Free shipping on all orders above ₹999. Standard delivery in 3-7 business days. Express delivery available at ₹149.</p>',                                                                              isActive: true, showInFooter: true,  showInNav: false, sortOrder: 4 },
  { title: 'FAQ',                slug: 'faq',             content: '<h1>Frequently Asked Questions</h1><h2>How long does delivery take?</h2><p>Standard: 3-7 business days. Express: 1-3 business days.</p><h2>Can I return or exchange?</h2><p>Yes, within 7 days of delivery.</p>',               isActive: true, showInFooter: true,  showInNav: false, sortOrder: 5 },
];

// ── database initialisation ───────────────────────────────────────────────────
async function initDatabase() {
  // 1. Settings
  await prisma.setting.createMany({ data: INIT_SETTINGS, skipDuplicates: true });

  // 2. Admin user — only if no SUPER_ADMIN exists yet
  //
  // This block previously fell back to a hardcoded 'Admin@123'. That constant
  // is committed to a repository, so every deployment that did not set
  // ADMIN_PASSWORD shipped with a publicly-known super-admin credential — and
  // production was in exactly that state until 2026-08-08. There is now no
  // literal default: either the operator supplies one, or a random password is
  // generated and printed once to the server log.
  const adminCount = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  if (adminCount === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@uniquedressup.com';

    const supplied = process.env.ADMIN_PASSWORD;
    const generated = !supplied ? crypto.randomBytes(18).toString('base64url') : null;
    const adminPassword = supplied || generated!;

    // NOTE: if the server previously started with a different ADMIN_EMAIL env var,
    // the admin may already exist with that email. Run scripts/checkAdmin.ts to fix.
    const hashed = await bcrypt.hash(adminPassword, 12);
    await prisma.user.create({
      data: {
        email: adminEmail, password: hashed,
        firstName: 'Admin', lastName: 'User',
        role: 'SUPER_ADMIN', isVerified: true,
      },
    });

    if (generated) {
      // Printed once, and only here. Nothing recoverable is stored, so this is
      // the single opportunity to capture it.
      logger.warn(
        `Admin created — ${adminEmail}\n` +
        `  Generated password (shown once, change it after first login): ${generated}\n` +
        `  Set ADMIN_PASSWORD to choose your own instead.`
      );
    } else {
      logger.info(`Admin created — email: ${adminEmail} (password from ADMIN_PASSWORD)`);
    }
  }

  // 3. Categories (unique by slug)
  await prisma.category.createMany({
    skipDuplicates: true,
    data: INIT_CATEGORIES.map(c => ({
      name: c.name, slug: toSlug(c.name), description: c.desc,
      isFeatured: c.featured, isActive: true, showInNav: true,
      metaTitle: `${c.name} | Unique Dressup`,
      metaDesc: `Shop ${c.name} at Unique Dressup. Free shipping above ₹999.`,
    })),
  });

  // 4. Collections (unique by slug)
  await prisma.collection.createMany({
    skipDuplicates: true,
    data: INIT_COLLECTIONS.map(c => ({
      name: c.name, slug: toSlug(c.name), description: c.desc,
      isActive: true, isFeatured: true,
    })),
  });

  // 5. Homepage sections — only if none exist yet
  if ((await prisma.homepageSection.count()) === 0) {
    await prisma.homepageSection.createMany({
      data: INIT_HOMEPAGE_SECTIONS.map(s => ({ ...s, type: s.type as HomepageSectionType })),
    });
  }

  // 6. Banners — only if none exist yet
  if ((await prisma.banner.count()) === 0) {
    await prisma.banner.createMany({
      data: INIT_BANNERS.map(b => ({ ...b, type: b.type as BannerType })),
    });
  }

  // 7. Testimonials — only if none exist yet
  if ((await prisma.testimonial.count()) === 0) {
    await prisma.testimonial.createMany({ data: INIT_TESTIMONIALS });
  }

  // 8. Coupons (unique by code)
  await prisma.coupon.createMany({
    data: INIT_COUPONS.map(c => ({ ...c, type: c.type as CouponType })),
    skipDuplicates: true,
  });

  // 9. SEO meta (unique by page)
  await prisma.seoMeta.createMany({ data: INIT_SEO, skipDuplicates: true });

  // 10. CMS pages (unique by slug)
  await prisma.cmsPage.createMany({ data: INIT_CMS_PAGES, skipDuplicates: true });

  logger.info('Database initialised');
}

// ── startup ───────────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    await initDatabase();

    const server = app.listen(PORT, () => {
      logger.info(`Server running in ${config.nodeEnv} mode on port ${PORT}`);
      logger.info(`API: http://localhost:${PORT}/api/v1`);
    });

    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} received. Shutting down...`);
      const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, 10_000);
      forceExit.unref();

      server.close(async () => {
        clearTimeout(forceExit);
        await prisma.$disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

    process.on('unhandledRejection', (reason: Error) => {
      logger.error('Unhandled rejection:', reason);
    });

    process.on('uncaughtException', (err: Error) => {
      logger.error('Uncaught exception:', err);
      gracefulShutdown('uncaughtException');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
