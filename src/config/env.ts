import dotenv from 'dotenv';
dotenv.config();

const REQUIRED_IN_PROD = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL'];
if (process.env.NODE_ENV === 'production') {
  const missing = REQUIRED_IN_PROD.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`FATAL: missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:5000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  adminUrl: process.env.ADMIN_URL || 'http://localhost:3000/admin',

  db: {
    url: process.env.DATABASE_URL || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_secret_change_in_production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret',
    expire: process.env.JWT_EXPIRE || '1d',
    refreshExpire: process.env.JWT_REFRESH_EXPIRE || '30d',
  },

  upload: {
    path: process.env.UPLOAD_PATH || './uploads',
    // Raised from 5 MB to 25 MB so HD/studio originals can be stored untouched.
    // This is safe only because nothing serves the original to the storefront —
    // see src/utils/imagePipeline.ts. Do not raise the ceiling without keeping
    // image.maxInputPixels in step.
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '26214400', 10),
    allowedTypes: (process.env.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/jpg,image/png,image/webp,image/avif,image/tiff').split(','),
  },

  image: {
    // Disk cache for generated derivatives. Kept inside the uploads volume so a
    // single mount survives redeploys, but dot-prefixed so it is never served
    // by the /uploads static handler.
    cachePath: process.env.IMAGE_CACHE_PATH || `${process.env.UPLOAD_PATH || './uploads'}/.derivatives`,
    // ~100 megapixels. Bounds decode memory for a hostile or accidental
    // "decompression bomb" now that we accept 25 MB uploads.
    maxInputPixels: parseInt(process.env.IMAGE_MAX_INPUT_PIXELS || '100000000', 10),
    // libvips threads PER worker. PM2 runs `instances: 'max'`, so leaving this
    // at the default (one per core, per worker) oversubscribes the CPU badly.
    sharpConcurrency: parseInt(process.env.SHARP_CONCURRENCY || '2', 10),
    // Formats generated eagerly on upload. Both are worth pre-warming: AVIF for
    // modern browsers, WebP as the universal fallback.
    prewarmFormats: (process.env.IMAGE_PREWARM_FORMATS || 'avif,webp').split(',') as ('avif' | 'webp')[],
    // Set false to disable on-upload pre-warming (e.g. on a memory-tight box).
    prewarmOnUpload: process.env.IMAGE_PREWARM_ON_UPLOAD !== 'false',
    // How many background encodes may run at once. Keep at 1 on a 1-2 core VPS:
    // a 1920w AVIF takes seconds, and background work must never compete with
    // request handling. Raise cautiously on a dedicated box.
    backgroundConcurrency: parseInt(process.env.IMAGE_BACKGROUND_CONCURRENCY || '1', 10),
    // Backlog ceiling; the oldest queued job is dropped beyond this. Dropped
    // work is regenerated lazily on first request, so this is a throttle rather
    // than data loss.
    maxBackgroundQueue: parseInt(process.env.IMAGE_MAX_BACKGROUND_QUEUE || '500', 10),
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  },

  cashfree: {
    appId: process.env.CASHFREE_APP_ID || '',
    secretKey: process.env.CASHFREE_SECRET_KEY || '',
    env: (process.env.CASHFREE_ENV || 'sandbox') as 'sandbox' | 'production',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },

  // Brevo (formerly Sendinblue). Their HTTP API is preferred over their SMTP
  // relay: a delivery code is sent while somebody waits at a door, and the API
  // both answers faster and says *why* it refused, which SMTP does not.
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromEmail: process.env.FROM_EMAIL || 'noreply@fashionstore.com',
    fromName: process.env.FROM_NAME || 'Fashion Store',
    /** Replies go here — the From domain has no inbox behind it. */
    replyTo: process.env.REPLY_TO_EMAIL || process.env.SITE_EMAIL || '',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
};
