import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../config/env';
import { logger } from './logger';

/**
 * On-demand image derivative pipeline.
 *
 * Design contract:
 *   - The ORIGINAL upload is never modified or downscaled. It stays on disk at
 *     full quality and remains reachable at /uploads/<path>.
 *   - Everything the storefront renders is a DERIVATIVE produced here: resized
 *     to the requested width, re-encoded to AVIF/WebP, and written to a disk
 *     cache so the transform cost is paid at most once per (file, w, q, format).
 *   - Cache keys embed the source file's mtime + size, so replacing an image on
 *     disk automatically invalidates every derivative without a manual purge.
 *
 * This is what lets us raise the upload limit to HD sizes without making the
 * storefront slower: big in, small out.
 */

export type ImageFormat = 'avif' | 'webp' | 'jpeg' | 'png';

/**
 * Allowed output widths. Requests are snapped UP to the nearest entry so a
 * hostile or careless caller cannot spray thousands of distinct widths and
 * balloon the cache (or pin the CPU). Mirrors the frontend's deviceSizes +
 * imageSizes so the Next.js loader never asks for a width we don't serve.
 */
export const RESPONSIVE_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 320, 384, 480, 640, 750, 828,
  1080, 1200, 1440, 1920, 2048, 2560, 3840,
] as const;

/**
 * Quality defaults tuned for garment photography, where colour banding on
 * gradients and mushy fabric texture are the usual give-aways of over-
 * compression. AVIF at 62 is visually on par with WebP at ~86 while being
 * materially smaller.
 */
const QUALITY_DEFAULTS: Record<ImageFormat, number> = {
  avif: 62,
  webp: 86,
  jpeg: 88,
  png: 100,
};

const SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tiff', '.tif']);

/**
 * Bump whenever the ENCODER SETTINGS change (chroma, sharpening, quality
 * curve). The cache key is otherwise derived only from source identity +
 * width/format/quality, so a settings change would keep serving derivatives
 * produced by the old encoder forever. Incrementing this invalidates every
 * cached entry; the old files become unreachable and are reclaimed by the
 * sweeper.
 *
 *   v1 — initial: AVIF 4:2:0, no sharpening
 *   v2 — AVIF 4:4:4 + mild sharpening on significant downscale
 */
const PIPELINE_VERSION = 'v2';

/**
 * Below this ratio the image is barely being downscaled and resampling costs
 * almost no acutance, so sharpening would only add halos.
 */
const SHARPEN_MIN_DOWNSCALE = 1.5;

// ── Sharp runtime tuning ─────────────────────────────────────────────────────
// PM2 runs in cluster mode with `instances: 'max'`. Sharp defaults to one
// libvips thread per core PER WORKER, so N workers x N cores oversubscribes the
// box badly under load. Cap concurrency per worker and bound the pixel budget
// so a crafted "decompression bomb" (a 100MB PNG that expands to 30 GB of RGBA)
// cannot exhaust memory now that we accept larger uploads.
sharp.concurrency(config.image.sharpConcurrency);
sharp.cache({ memory: 64, files: 0, items: 128 });

const MAX_INPUT_PIXELS = config.image.maxInputPixels;

// ── Paths ────────────────────────────────────────────────────────────────────

const uploadRoot = () => path.resolve(config.upload.path);
const cacheRoot = () => path.resolve(config.image.cachePath);

/**
 * Resolve a caller-supplied relative path against the uploads root, refusing
 * anything that escapes it.
 *
 * This is the security boundary of the whole module: the derivative endpoint
 * takes an arbitrary path from the URL, so `../../etc/passwd` and absolute
 * paths must both be rejected. Returns null when the path is not acceptable.
 */
export const resolveSourcePath = (relativePath: string): string | null => {
  if (!relativePath) return null;

  // Reject NUL bytes and URL-encoded traversal before normalising.
  if (relativePath.includes('\0')) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;

  const root = uploadRoot();
  const absolute = path.resolve(root, `.${path.sep}${decoded.replace(/^[/\\]+/, '')}`);

  // path.relative gives '..' -prefixed output when `absolute` sits outside root.
  const rel = path.relative(root, absolute);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;

  if (!SOURCE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) return null;

  return absolute;
};

/** Snap an arbitrary requested width up to the nearest allowed bucket. */
export const normalizeWidth = (requested?: number | string): number | undefined => {
  if (requested === undefined || requested === null || requested === '') return undefined;
  const n = typeof requested === 'number' ? requested : parseInt(requested, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const max = RESPONSIVE_WIDTHS[RESPONSIVE_WIDTHS.length - 1];
  if (n >= max) return max;
  return RESPONSIVE_WIDTHS.find((w) => w >= n) ?? max;
};

export const normalizeFormat = (requested?: string): ImageFormat | undefined => {
  if (!requested) return undefined;
  const f = requested.toLowerCase();
  return f === 'avif' || f === 'webp' || f === 'jpeg' || f === 'png' ? f : undefined;
};

export const normalizeQuality = (requested?: number | string, format: ImageFormat = 'webp'): number => {
  const fallback = QUALITY_DEFAULTS[format];
  if (requested === undefined || requested === null || requested === '') return fallback;
  const n = typeof requested === 'number' ? requested : parseInt(requested, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(35, n));
};

/**
 * Pick the best format the client actually supports, honouring the Accept
 * header. Browsers that understand AVIF get AVIF; the rest fall back to WebP,
 * which has been universally supported since 2020.
 */
export const negotiateFormat = (acceptHeader?: string): ImageFormat => {
  const accept = (acceptHeader || '').toLowerCase();
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return 'jpeg';
};

// ── Cache key ────────────────────────────────────────────────────────────────

interface DerivativeSpec {
  width?: number;
  format: ImageFormat;
  quality: number;
  /**
   * Trade compression ratio for encode speed. Used only on the request path
   * when a cache miss would otherwise make the visitor wait seconds; the
   * high-compression version is produced in the background straight after.
   */
  fast?: boolean;
}

/**
 * Cache filename derived from the source identity (path + mtime + size) and the
 * output spec. Including mtime/size means an admin who overwrites an image gets
 * fresh derivatives automatically — no cache-busting query strings needed.
 */
const cacheKeyFor = (absoluteSource: string, stat: fs.Stats, spec: DerivativeSpec): string => {
  const identity = [
    PIPELINE_VERSION,
    path.relative(uploadRoot(), absoluteSource),
    stat.mtimeMs,
    stat.size,
    spec.width ?? 'orig',
    spec.format,
    spec.quality,
  ].join('|');
  return crypto.createHash('sha1').update(identity).digest('hex');
};

const cachePathFor = (key: string, format: ImageFormat): string =>
  // Two-level shard keeps directory entry counts sane on ext4 once a catalogue
  // of a few thousand products has been through the pipeline.
  path.join(cacheRoot(), key.slice(0, 2), key.slice(2, 4), `${key}.${format}`);

// ── Transform ────────────────────────────────────────────────────────────────

/**
 * De-duplicates concurrent work. Without this, a cold cache plus a product grid
 * of 24 images means every visitor in the first seconds after a deploy triggers
 * the same 24 transforms simultaneously.
 */
const inFlight = new Map<string, Promise<string>>();

// ── Background work queue ────────────────────────────────────────────────────
/**
 * Serialises pre-warm and upgrade encodes.
 *
 * A 10-image product upload would otherwise fan out to ~70 concurrent AVIF
 * encodes; at ~5s each on a multi-core box (far worse on a 2-core VPS) that
 * starves the event loop and makes the API unresponsive precisely when an admin
 * is waiting on a page to load. Draining one or two at a time keeps background
 * work invisible to request latency.
 */
const backgroundQueue: Array<() => Promise<void>> = [];
let backgroundActive = 0;

const drainBackground = () => {
  while (backgroundActive < config.image.backgroundConcurrency && backgroundQueue.length > 0) {
    const job = backgroundQueue.shift()!;
    backgroundActive++;
    job()
      .catch((error) => logger.warn(`Background image job failed: ${(error as Error).message}`))
      .finally(() => {
        backgroundActive--;
        // setImmediate yields to pending I/O between jobs rather than
        // synchronously chaining straight into the next encode.
        setImmediate(drainBackground);
      });
  }
};

const enqueuePrewarm = (job: () => Promise<void>) => {
  // Bound the backlog. If uploads arrive faster than the box can encode, drop
  // the oldest queued work: those derivatives get generated lazily on first
  // request instead, which is strictly better than an unbounded queue.
  if (backgroundQueue.length >= config.image.maxBackgroundQueue) {
    backgroundQueue.shift();
    logger.warn('Image pre-warm queue full — dropping oldest job');
  }
  backgroundQueue.push(job);
  setImmediate(drainBackground);
};

/** Exposed for the health endpoint / diagnostics. */
export const backgroundQueueDepth = () => backgroundQueue.length + backgroundActive;

/**
 * Encoder settings, chosen from measurements on an 8-core box using a
 * photographic 2400x3000 source (see the AVIF/WebP benchmark in the PR notes):
 *
 *              1920w size   1920w time
 *   avif e=4      45 KB       5.1 s      ← best compression, too slow to block on
 *   avif e=0      96 KB       1.0 s      ← "fast" path for cache misses
 *   webp e=4     548 KB       4.9 s
 *
 * AVIF at effort 4 is ~12x smaller than WebP, which is why it is the primary
 * format. Because it is also slow, it is only ever produced ahead of time (or
 * in the background); requests never wait on it — see getDerivative().
 *
 * Note: avif effort=2 measured LARGER than both 0 and 4 (171 KB). libaom's
 * speed presets are not monotonic in size, so only 0 and 4 are used.
 */
const encode = (pipeline: sharp.Sharp, spec: DerivativeSpec): sharp.Sharp => {
  switch (spec.format) {
    case 'avif':
      return pipeline.avif({
        quality: spec.quality,
        effort: spec.fast ? 0 : 4,
        // 4:4:4 keeps full colour resolution. 4:2:0 halves it, which on
        // garment photography softens print edges and colour transitions —
        // measured 39.80 dB PSNR at 4:2:0 vs 41.43 dB at 4:4:4 (above the
        // ~40 dB visually-lossless threshold) for only ~9% more bytes.
        chromaSubsampling: '4:4:4',
      });
    case 'webp':
      return pipeline.webp({
        quality: spec.quality,
        effort: spec.fast ? 0 : 4,
        smartSubsample: true,
      });
    case 'png':
      return pipeline.png({ compressionLevel: spec.fast ? 6 : 9, palette: true });
    case 'jpeg':
    default:
      return pipeline.jpeg({ quality: spec.quality, mozjpeg: !spec.fast, progressive: true });
  }
};

const runTransform = async (
  absoluteSource: string,
  destination: string,
  spec: DerivativeSpec
): Promise<string> => {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  // Read to a buffer first so libvips releases the source handle before we
  // rename over the destination — matches the existing banner pipeline, which
  // hit EBUSY on Windows dev machines otherwise.
  const input = await fs.promises.readFile(absoluteSource);

  let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
    // Bake in EXIF orientation, otherwise phone photos come out sideways once
    // the metadata is dropped.
    .rotate();

  if (spec.width) {
    pipeline = pipeline.resize({
      width: spec.width,
      // Never upscale: asking for 2560w from a 1200w original returns 1200w
      // rather than a soft, interpolated fake.
      withoutEnlargement: true,
      fit: 'inside',
    });

    // Any resampling costs acutance, and the more we shrink the more is lost —
    // a 2400px studio shot squeezed into a 480px grid tile comes out
    // noticeably soft. Restore it with a damped unsharp mask.
    //
    // m1/m2 are deliberately low (0.5): sharp's defaults (1.0/2.0) over-drive
    // flat areas, inflating AVIF by ~27% and putting halos on garment edges.
    // At these settings the cost is ~8% and the result stays natural.
    //
    // Skipped for mild downscales, where there is nothing to recover.
    const sourceWidth = (await sharp(input).metadata()).width ?? spec.width;
    if (sourceWidth / spec.width >= SHARPEN_MIN_DOWNSCALE) {
      pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0.5, m2: 0.5 });
    }
  }

  // Retain the embedded ICC profile. Stripping it is what makes garment photos
  // shot in Adobe RGB render dull and washed-out in the browser — unacceptable
  // for a fashion catalogue, and worth the ~1 KB it costs.
  pipeline = pipeline.withMetadata();

  const buffer = await encode(pipeline, spec).toBuffer();

  // Write to a temp file then rename, so a crash mid-encode can never leave a
  // truncated image in the cache to be served forever.
  const temp = `${destination}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, buffer);
  await fs.promises.rename(temp, destination);

  return destination;
};

/**
 * Return the on-disk path of a derivative, producing it if the cache misses.
 * Throws only when the source is unreadable or not a decodable image.
 *
 * `fast` is deliberately excluded from the cache key, so the quick encode and
 * the high-compression encode target the same file. A cache miss therefore
 * serves the fast version immediately and then upgrades that same file in the
 * background — writes are atomic (temp + rename), so a concurrent reader can
 * never observe a half-written image.
 */
export const getDerivative = async (
  absoluteSource: string,
  spec: DerivativeSpec
): Promise<string> => {
  const stat = await fs.promises.stat(absoluteSource);
  const key = cacheKeyFor(absoluteSource, stat, spec);
  const destination = cachePathFor(key, spec.format);

  try {
    await fs.promises.access(destination, fs.constants.R_OK);
    return destination; // cache hit — the common case once pre-warmed
  } catch {
    // cache miss — fall through
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  // On the request path, encode with the fast preset so the visitor waits ~1s
  // rather than ~5s, then queue the high-compression re-encode behind it.
  const useFast = spec.fast ?? true;

  const work = runTransform(absoluteSource, destination, { ...spec, fast: useFast })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  const produced = await work;

  if (useFast) {
    // Upgrade to the smaller, slower encode out of band. Failure is harmless:
    // the fast version stays in place and is still perfectly valid.
    enqueuePrewarm(() =>
      runTransform(absoluteSource, destination, { ...spec, fast: false }).then(() => undefined)
    );
  }

  return produced;
};

// ── LQIP (low-quality image placeholder) ─────────────────────────────────────

const lqipCache = new Map<string, string>();

/**
 * Produce a ~20px wide blurred data URL used as an inline blur-up placeholder.
 * Typically 300–600 bytes, so it can be inlined into server-rendered HTML and
 * shown instantly — the page never flashes an empty grey box.
 */
export const getLqip = async (absoluteSource: string): Promise<string | null> => {
  try {
    const stat = await fs.promises.stat(absoluteSource);
    const key = `${absoluteSource}|${stat.mtimeMs}|${stat.size}`;

    const hit = lqipCache.get(key);
    if (hit) return hit;

    const input = await fs.promises.readFile(absoluteSource);
    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
      .rotate()
      .resize({ width: 20, withoutEnlargement: true, fit: 'inside' })
      .blur(1.2)
      .webp({ quality: 45, alphaQuality: 60 })
      .toBuffer();

    const dataUrl = `data:image/webp;base64,${buffer.toString('base64')}`;

    // Bounded so a large catalogue cannot grow this map without limit.
    if (lqipCache.size > 2000) lqipCache.clear();
    lqipCache.set(key, dataUrl);

    return dataUrl;
  } catch {
    return null;
  }
};

// ── Upload resolution guard ──────────────────────────────────────────────────

/**
 * Minimum acceptable source width per upload folder.
 *
 * The pipeline deliberately never upscales, so a source smaller than the box it
 * is rendered into is stretched by the BROWSER — which is the one form of blur
 * no encoder setting can fix. A 255px product photo in a retina grid tile is
 * shown at roughly 720 device pixels, a 2.8x upscale, and looks exactly as bad
 * as that sounds.
 *
 * These floors are set from the largest width each surface actually requests
 * (see RESPONSIVE_WIDTHS and the `sizes` attributes on the storefront), not
 * from an arbitrary "big enough" figure.
 */
export const MIN_SOURCE_WIDTH: Record<string, number> = {
  products: 1000,   // product grid asks for up to 828w, detail view up to 1920w
  categories: 800,  // category cards render around 640w on desktop
  banners: 1440,    // hero spans the viewport
  // Reel cards render 240px wide at 9:16; 3x for high-DPR screens.
  reels: 720,
  media: 600,
  blogs: 800,
  stores: 600,
  users: 200,       // avatars are small by nature
};

export interface ResolutionCheck {
  ok: boolean;
  width: number | null;
  height: number | null;
  required: number;
  message?: string;
}

/**
 * Verify an uploaded file is large enough for the surface it feeds.
 * Returns a structured result rather than throwing, so callers can decide
 * whether to reject outright or merely warn.
 */
export const checkSourceResolution = async (
  absolutePath: string,
  folder: string,
  /** Overrides the folder default — see validateUploadResolution. */
  requiredOverride?: number
): Promise<ResolutionCheck> => {
  const required = requiredOverride ?? MIN_SOURCE_WIDTH[folder] ?? 0;
  const meta = await readImageMetadata(absolutePath);

  if (!meta?.width || !meta?.height) {
    return {
      ok: false,
      width: null,
      height: null,
      required,
      message: 'The file could not be read as an image.',
    };
  }

  if (required && meta.width < required) {
    return {
      ok: false,
      width: meta.width,
      height: meta.height,
      required,
      message:
        `Image is only ${meta.width}x${meta.height}px. ` +
        `A width of at least ${required}px is required or it will look blurry on the site. ` +
        `Please upload the original, full-size photo rather than a thumbnail or screenshot.`,
    };
  }

  return { ok: true, width: meta.width, height: meta.height, required };
};

// ── Metadata ─────────────────────────────────────────────────────────────────

export const readImageMetadata = async (absoluteSource: string) => {
  try {
    const input = await fs.promises.readFile(absoluteSource);
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' }).metadata();
    // `rotate()` is applied at serve time, so report post-rotation dimensions.
    const swap = meta.orientation !== undefined && meta.orientation >= 5;
    return {
      width: swap ? meta.height : meta.width,
      height: swap ? meta.width : meta.height,
      format: meta.format,
      size: input.length,
    };
  } catch {
    return null;
  }
};

// ── Pre-warming ──────────────────────────────────────────────────────────────

/**
 * Widths generated eagerly, per format.
 *
 * AVIF is the primary format (~95% browser support) so it gets the full ladder.
 * WebP exists only as a fallback for Safari < 16 and older Android, so it is
 * pre-warmed at the two widths that dominate those devices — phone-sized grid
 * and detail images. Anything else is produced on demand. This roughly halves
 * the CPU cost per upload versus warming both formats at every width.
 */
const PREWARM_WIDTHS: Record<'avif' | 'webp', number[]> = {
  avif: [256, 480, 640, 828, 1080, 1440, 1920],
  webp: [480, 828],
};

/**
 * Generate the common derivatives for a freshly uploaded file, off the request
 * path. Failures are logged and swallowed: a pre-warm miss only means the first
 * visitor pays for the transform, which is not worth failing an upload over.
 */
export const prewarmDerivatives = (absoluteSource: string): void => {
  enqueuePrewarm(async () => {
    const started = Date.now();
    const meta = await readImageMetadata(absoluteSource);
    const sourceWidth = meta?.width ?? Number.MAX_SAFE_INTEGER;
    let generated = 0;

    for (const format of config.image.prewarmFormats) {
      for (const width of PREWARM_WIDTHS[format] ?? []) {
        // Skip buckets wider than the source: withoutEnlargement would emit a
        // byte-for-byte duplicate of the next size down.
        if (width > sourceWidth * 1.05) continue;

        const stat = await fs.promises.stat(absoluteSource);
        const spec: DerivativeSpec = { width, format, quality: QUALITY_DEFAULTS[format] };
        const destination = cachePathFor(cacheKeyFor(absoluteSource, stat, spec), format);

        // Pre-warm always uses the high-compression encoder — nobody is waiting.
        try {
          await fs.promises.access(destination, fs.constants.R_OK);
        } catch {
          await runTransform(absoluteSource, destination, { ...spec, fast: false });
          generated++;
        }
      }
    }

    await getLqip(absoluteSource);

    logger.debug(
      `Pre-warmed ${generated} derivative(s) for ${path.basename(absoluteSource)} ` +
      `in ${Date.now() - started}ms (queue depth ${backgroundQueueDepth()})`
    );
  });
};

/** Best-effort removal of every cached derivative of a deleted source image. */
export const purgeDerivatives = async (absoluteSource: string): Promise<void> => {
  // Derivatives are keyed by a hash that includes mtime, so we cannot enumerate
  // them from the source path alone. They are self-evicting (an unreachable
  // source is never requested again) and the sweeper script reclaims the disk.
  // Nothing to do here beyond dropping the in-process LQIP entries.
  for (const key of lqipCache.keys()) {
    if (key.startsWith(`${absoluteSource}|`)) lqipCache.delete(key);
  }
};

export const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';
export { QUALITY_DEFAULTS };
