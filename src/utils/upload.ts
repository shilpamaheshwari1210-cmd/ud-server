import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { prewarmDerivatives, checkSourceResolution } from './imagePipeline';
import { logger } from './logger';

type UploadFolder = 'products' | 'banners' | 'categories' | 'blogs' | 'users' | 'media' | 'stores' | 'reels';

const getUploadPath = (folder: UploadFolder): string => {
  const dir = path.join(config.upload.path, folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const storage = (folder: UploadFolder) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, getUploadPath(folder));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const filename = `${uuidv4()}${ext}`;
      cb(null, filename);
    },
  });

/** Video types accepted for Instagram reels. */
export const VIDEO_MIME_TYPES = [
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
  'video/x-matroska', 'video/3gpp', 'video/3gpp2', 'video/x-msvideo', 'video/mpeg',
];

/**
 * Browsers are unreliable about video MIME types. Phones and several Android
 * browsers hand a perfectly good reel over as `application/octet-stream`, or
 * with no type at all, so a MIME-only allow-list refuses real uploads for a
 * reason the admin cannot act on.
 *
 * When the type is that vague, the extension decides — and ffprobe still has
 * the final say downstream, since it is the only check here that actually
 * opens the file and confirms it is playable.
 */
const AMBIGUOUS_MIME_TYPES = ['application/octet-stream', 'binary/octet-stream', ''];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.3gp', '.avi', '.mpeg', '.mpg'];

const makeFileFilter = (allowed?: string[]) =>
  (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const permitted = allowed ?? config.upload.allowedTypes;
    const videosWelcome = permitted.some(t => t.startsWith('video/'));

    if (permitted.includes(file.mimetype)) return cb(null, true);

    if (videosWelcome && AMBIGUOUS_MIME_TYPES.includes(file.mimetype ?? '')) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (VIDEO_EXTENSIONS.includes(ext)) return cb(null, true);
    }

    const kind = videosWelcome ? 'images or videos' : 'images';
    cb(new Error(`Invalid file type "${file.mimetype}". Only ${kind} are allowed.`));
  };

const fileFilter = makeFileFilter();

export const createUploader = (
  folder: UploadFolder,
  maxFileSizeBytes?: number,
  allowedMimeTypes?: string[]
) =>
  multer({
    storage: storage(folder),
    fileFilter: allowedMimeTypes ? makeFileFilter(allowedMimeTypes) : fileFilter,
    limits: { fileSize: maxFileSizeBytes ?? config.upload.maxFileSize },
  });

/**
 * Wrap a multer middleware so size/type rejections surface as a clean 400
 * carrying the actual limit, instead of bubbling to the generic 500 handler.
 *
 * Previously only the banner and store routes did this, so an oversized product
 * image failed with an opaque "Internal Server Error" and the admin had no way
 * to know why.
 */
export const handleUpload = (
  middleware: (req: Request, res: Response, cb: (err?: any) => void) => void,
  maxFileSizeBytes?: number
) => {
  const limit = maxFileSizeBytes ?? config.upload.maxFileSize;
  const limitMb = Math.round((limit / (1024 * 1024)) * 10) / 10;

  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err?: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: `Image is too large. Maximum size is ${limitMb} MB.`,
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ success: false, message: 'Too many files uploaded.' });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      if (err) {
        // fileFilter rejections land here (invalid MIME type)
        return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
      }
      return next();
    });
  };
};

/**
 * Every file multer attached to this request, however it was attached.
 *
 * `.array()` puts them in an array, `.fields()` in an object keyed by field
 * name, and `.single()` on `req.file`. Cleanup paths that only knew one shape
 * silently left the others on disk.
 */
export const uploadedFiles = (req: Request): Express.Multer.File[] => {
  const raw = req.files as
    | Express.Multer.File[]
    | Record<string, Express.Multer.File[]>
    | undefined;

  const collected: Express.Multer.File[] = Array.isArray(raw)
    ? raw
    : raw
      ? Object.values(raw).flat()
      : [];
  if (req.file) collected.push(req.file);
  return collected;
};

/**
 * Delete everything this request uploaded. Called whenever a handler rejects
 * after multer has already written to disk — without it a refused upload keeps
 * its bytes forever, and a 60 MB reel video is an expensive thing to leak.
 */
export const discardUploads = async (req: Request): Promise<void> => {
  const files = uploadedFiles(req);
  if (!files.length) return;
  await Promise.all(files.map(f => fs.promises.unlink(f.path).catch(() => {})));
  logger.info(`Discarded ${files.length} uploaded file(s) after a rejected request`);
};

/**
 * Reject uploads whose source resolution is too low for where they will be
 * displayed.
 *
 * Runs AFTER multer (which has already written the file to disk) and deletes
 * anything it rejects, so a failed upload leaves nothing behind.
 *
 * This is the only fix for the most common cause of "the image looks blurry":
 * the pipeline never upscales, so a source narrower than its render box is
 * stretched by the browser and no encoder setting can recover the detail.
 * Catching it at upload tells the admin immediately, instead of the problem
 * surfacing later as a customer complaint.
 *
 * Set IMAGE_MIN_RESOLUTION_ENFORCE=false to log warnings instead of rejecting.
 */
export const validateUploadResolution = (
  folder: UploadFolder,
  /**
   * Per-field overrides of the folder minimum.
   *
   * A folder-wide floor is too blunt once a request carries images with
   * different jobs. A desktop hero spans the viewport and needs >=1440px, but
   * the portrait crop beside it is displayed at phone width — 1080x1440 is the
   * standard for that and would be rejected by the desktop floor for no reason.
   */
  fieldMinimums: Record<string, number> = {}
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const collected = uploadedFiles(req);

    // Only images have a resolution to check. A reel's video shares the same
    // request, and running it through Sharp would fail and reject the upload.
    const files = collected.filter(f => f.mimetype.startsWith('image/'));
    if (files.length === 0) return next();

    const enforce = process.env.IMAGE_MIN_RESOLUTION_ENFORCE !== 'false';
    const failures: string[] = [];

    for (const file of files) {
      const override = fieldMinimums[file.fieldname];
      const result = await checkSourceResolution(file.path, folder, override).catch(() => null);
      if (result && !result.ok) {
        failures.push(`"${file.originalname}": ${result.message}`);
      }
    }

    if (failures.length === 0) return next();

    if (!enforce) {
      logger.warn(`Low-resolution upload allowed (enforcement off): ${failures.join(' | ')}`);
      return next();
    }

    // Reject: remove every file from this request so half-accepted uploads
    // never leave orphans on disk. `collected`, not `files` — `files` is only
    // the images that were checked, so rejecting a reel's poster used to strip
    // the poster and keep the video it arrived with.
    await Promise.all(collected.map(f => fs.promises.unlink(f.path).catch(() => {})));

    return res.status(400).json({
      success: false,
      message: failures.length === 1
        ? failures[0]
        : `${failures.length} images were rejected. ${failures.join(' ')}`,
    });
  };
};

export const optimizeImage = async (
  inputPath: string,
  outputPath?: string,
  options?: { width?: number; height?: number; quality?: number }
): Promise<string> => {
  const { width = 1200, height, quality = 85 } = options || {};
  const target = outputPath || inputPath.replace(/\.[^.]+$/, '.webp');

  await sharp(inputPath)
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toFile(target);

  if (target !== inputPath) {
    await fs.promises.unlink(inputPath).catch(() => {});
  }

  return target;
};

export const getImageUrl = (filePath: string): string => {
  if (!filePath) return '';
  const uploadRoot = path.resolve(config.upload.path);
  const absFile   = path.resolve(filePath);
  const rel       = path.relative(uploadRoot, absFile).replace(/\\/g, '/');

  // Every upload controller calls this exactly once per freshly-written file,
  // which makes it the single choke point where we can kick off derivative
  // generation for the whole application. Pre-warming is fire-and-forget on
  // setImmediate, so it never delays the upload response, and a failure only
  // means the first visitor pays for the transform instead.
  // Videos are not images — Sharp would only throw on them.
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(absFile);
  if (config.image.prewarmOnUpload && !isVideo) {
    prewarmDerivatives(absFile);
  }

  return `${config.baseUrl}/uploads/${rel}`;
};

export const deleteFile = async (filePath: string): Promise<void> => {
  await fs.promises.unlink(filePath).catch(() => {});
};

/**
 * Remove an uploaded file, and the files generated from it, given its URL.
 *
 * Deleting a record only ever removed the row — the bytes stayed on disk
 * forever. The reels directory had accumulated 178 MB that nothing referenced.
 *
 * A stored URL is data, not a trusted path, so this refuses anything that
 * resolves outside the upload root: `/uploads/../../etc/passwd` must not turn
 * into an unlink. Dotted directories are skipped too, which keeps the
 * derivative cache out of reach.
 *
 * Silent on missing files by design — callers delete the row either way, and a
 * file that is already gone is the desired end state.
 */
export const deleteUploadByUrl = async (url?: string | null): Promise<void> => {
  if (!url) return;

  const marker = '/uploads/';
  const at = url.indexOf(marker);
  if (at === -1) return; // an external URL is not ours to delete

  const rel = decodeURIComponent(url.slice(at + marker.length)).split('?')[0];
  if (!rel) return;

  const uploadRoot = path.resolve(config.upload.path);
  const abs = path.resolve(uploadRoot, rel);
  if (abs !== uploadRoot && !abs.startsWith(uploadRoot + path.sep)) {
    logger.warn(`Refusing to delete a path outside the upload root: ${url}`);
    return;
  }
  // Any dotted segment, at any depth — the derivative cache lives at
  // `.derivatives/ab/cd.avif`, so checking only the immediate parent missed it.
  const segments = path.relative(uploadRoot, abs).split(path.sep);
  if (segments.some(segment => segment.startsWith('.'))) return;

  const base = abs.replace(/\.[^.]+$/, '');
  const targets = new Set<string>([
    abs,
    `${base}-web.mp4`,
    `${base}-poster.jpg`,
    `${base}-web-poster.jpg`,
    `${base}-master.jpg`,
  ]);

  // A reel row points at the optimised rendition, so the untranscoded source
  // sits beside it under the pre-suffix name and would otherwise be left behind
  // — and it is the big one.
  if (base.endsWith('-web')) {
    const source = base.slice(0, -4);
    for (const ext of ['.mp4', '.webm', '.mov', '.m4v']) targets.add(source + ext);
    targets.add(`${source}-poster.jpg`);
  }

  let removed = 0;
  for (const target of targets) {
    try {
      await fs.promises.unlink(target);
      removed += 1;
    } catch {
      // not present — fine
    }
  }
  if (removed) logger.info(`Removed ${removed} file(s) for ${path.basename(abs)}`);
};
