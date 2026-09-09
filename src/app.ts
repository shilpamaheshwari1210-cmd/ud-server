import 'express-async-errors';
import express from 'express';

// Prisma $queryRaw returns BigInt for COUNT/SUM — make JSON.stringify handle it
(BigInt.prototype as any).toJSON = function () { return Number(this); };
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import xss from 'xss-clean';

import { config } from './config/env';
import { logger } from './utils/logger';
import { errorHandler, notFound } from './middlewares/error.middleware';

// Route imports
import authRoutes from './modules/auth/routes/auth.routes';
import productRoutes from './modules/products/routes/product.routes';
import categoryRoutes from './modules/categories/routes/category.routes';
import cartRoutes from './modules/cart/routes/cart.routes';
import orderRoutes from './modules/orders/routes/order.routes';
import paymentRoutes from './modules/payments/routes/payment.routes';
import wishlistRoutes from './modules/wishlist/routes/wishlist.routes';
import userRoutes from './modules/users/routes/user.routes';
import reviewRoutes from './modules/reviews/routes/review.routes';
import bannerRoutes from './modules/banners/routes/banner.routes';
import couponRoutes from './modules/coupons/routes/coupon.routes';
import collectionRoutes from './modules/collections/routes/collection.routes';
import homepageRoutes from './modules/homepage/routes/homepage.routes';
import blogRoutes from './modules/blogs/routes/blog.routes';
import analyticsRoutes from './modules/admin/routes/analytics.routes';
import settingsRoutes from './modules/settings/routes/settings.routes';
import seoRoutes from './modules/seo/routes/seo.routes';
import mediaRoutes from './modules/media/routes/media.routes';
import storeRoutes from './modules/stores/routes/store.routes';
import instagramReelsRoutes from './modules/instagram-reels/routes/instagram-reels.routes';
import returnRoutes from './modules/returns/routes/return.routes';
import navMenuRoutes from './modules/nav-menus/routes/nav-menu.routes';
import imageRoutes from './modules/images/routes/image.routes';

const app = express();

// Trust proxy (for deployment behind Nginx)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — always include local dev origins alongside configured production URLs
//
// `www.` is derived automatically from every configured origin. Without it,
// visitors who land on the www host fail every credentialed request: the logs
// showed a steady stream of `OPTIONS /api/v1/cart -> 500` from
// www.theuniquedressup.com, i.e. real customers unable to use their cart
// purely because the apex domain was the only origin registered.
const withWwwVariant = (url: string): string[] => {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    const host = parsed.host;
    const sibling = host.startsWith('www.')
      ? host.slice(4)
      : `www.${host}`;
    return [`${parsed.protocol}//${host}`, `${parsed.protocol}//${sibling}`];
  } catch {
    return [url]; // not a parseable URL — keep the literal value
  }
};

const ALLOWED_ORIGINS = [
  ...withWwwVariant(config.frontendUrl),
  ...withWwwVariant(config.adminUrl),
  // Comma-separated escape hatch for extra origins (staging, preview builds)
  // without needing a code change.
  ...(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server / curl / Postman (no Origin header)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
}));

// Rate limiting — disabled in development to avoid 429s during active work
if (config.isProd) {
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: { success: false, message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many auth attempts, please try again.' },
  });
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
}

// Body parsing — `verify` saves raw buffer for Cashfree webhook signature verification
app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// XSS protection
app.use(xss());

// Compression
app.use(compression());

// Logging
if (config.isDev) {
  app.use(morgan('dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// ── Image delivery ───────────────────────────────────────────────────────────
// Resized/re-encoded derivatives generated on demand and cached to disk.
// This is what the storefront renders; /uploads below keeps serving the
// untouched originals for admin previews and direct links.
// Mounted before the /uploads static handler so it is never shadowed by it.
app.use('/img', imageRoutes);

// Static file serving for uploads (ORIGINALS, at full quality).
// Filenames are UUIDs and therefore content-addressed in practice: a given
// name never changes meaning, so these can be cached indefinitely. The old
// 1-day max-age forced every repeat visitor into a revalidation round-trip.
app.use('/uploads', express.static(path.resolve(config.upload.path), {
  maxAge: '1y',
  etag: true,
  immutable: true,
  // The derivative cache lives under the uploads volume; never expose it.
  dotfiles: 'deny',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Timing-Allow-Origin', '*');
  },
}));

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
const v1 = '/api/v1';
app.use(`${v1}/auth`, authRoutes);
app.use(`${v1}/products`, productRoutes);
app.use(`${v1}/categories`, categoryRoutes);
app.use(`${v1}/cart`, cartRoutes);
app.use(`${v1}/orders`, orderRoutes);
app.use(`${v1}/payments`, paymentRoutes);
app.use(`${v1}/wishlist`, wishlistRoutes);
app.use(`${v1}/users`, userRoutes);
app.use(`${v1}/reviews`, reviewRoutes);
app.use(`${v1}/banners`, bannerRoutes);
app.use(`${v1}/coupons`, couponRoutes);
app.use(`${v1}/collections`, collectionRoutes);
app.use(`${v1}/homepage`, homepageRoutes);
app.use(`${v1}/blogs`, blogRoutes);
app.use(`${v1}/analytics`, analyticsRoutes);
app.use(`${v1}/settings`, settingsRoutes);
app.use(`${v1}/seo`, seoRoutes);
app.use(`${v1}/media`, mediaRoutes);
app.use(`${v1}/stores`, storeRoutes);
app.use(`${v1}/instagram-reels`, instagramReelsRoutes);
app.use(`${v1}/returns`, returnRoutes);
app.use(`${v1}/nav-menus`, navMenuRoutes);

// 404 & error handler
app.use(notFound);
app.use(errorHandler);

export default app;
