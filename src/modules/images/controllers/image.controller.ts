import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { sendError, sendSuccess } from '../../../utils/response';
import { logger } from '../../../utils/logger';
import {
  resolveSourcePath,
  normalizeWidth,
  normalizeFormat,
  normalizeQuality,
  negotiateFormat,
  getDerivative,
  getLqip,
  readImageMetadata,
  CACHE_CONTROL_IMMUTABLE,
} from '../../../utils/imagePipeline';

/**
 * Image delivery endpoints.
 *
 * These sit OUTSIDE /api/v1 on purpose: they return image bytes rather than the
 * JSON envelope, and they are meant to be cached hard by nginx/CDN, which is
 * easier to reason about on a dedicated path prefix.
 *
 *   GET /img/<path>?w=800&f=avif&q=82   → transformed image bytes
 *   GET /img/meta/<path>                → { width, height, lqip } as JSON
 */
export class ImageController {
  /**
   * Serve a resized/re-encoded derivative of an uploaded image.
   *
   * Everything the caller controls is normalised or rejected before it reaches
   * Sharp: the path is confined to the uploads root, the width is snapped to a
   * fixed bucket list, and quality is clamped.
   */
  async serve(req: Request, res: Response) {
    // `/img/products/abc.jpg` → params[0] === 'products/abc.jpg'
    const requestedPath = (req.params as Record<string, string>)[0] || '';

    const source = resolveSourcePath(requestedPath);
    if (!source) {
      return sendError(res, 'Invalid image path', 400);
    }

    if (!fs.existsSync(source)) {
      return sendError(res, 'Image not found', 404);
    }

    const { w, q, f } = req.query as Record<string, string>;

    // Explicit ?f= wins; otherwise pick the best format the browser advertises.
    const format = normalizeFormat(f) ?? negotiateFormat(req.headers.accept);
    const width = normalizeWidth(w);
    const quality = normalizeQuality(q, format);

    try {
      const derivative = await getDerivative(source, { width, format, quality });
      const stat = await fs.promises.stat(derivative);

      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', CACHE_CONTROL_IMMUTABLE);
      // Same URL can return AVIF or WebP depending on the request, so shared
      // caches must key on Accept or they will poison one browser with the
      // other's format.
      res.setHeader('Vary', 'Accept');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Lets the storefront (a different origin) read the image via <canvas>
      // and lets Next.js fetch it without CORS complaints.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Timing-Allow-Origin', '*');

      return res.sendFile(derivative);
    } catch (error) {
      logger.error(`Image transform failed for ${requestedPath}: ${(error as Error).message}`);

      // Degrade gracefully: if the transform fails (corrupt file, unsupported
      // encoding) fall back to streaming the original rather than showing a
      // broken image on the storefront.
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.sendFile(source, (err) => {
        if (err && !res.headersSent) sendError(res, 'Image could not be processed', 500);
      });
    }
  }

  /**
   * Dimensions + inline blur placeholder for a source image.
   *
   * Server Components call this while rendering so the HTML ships with a real
   * blur-up placeholder and a correct aspect ratio, which removes both the
   * empty-box flash and the layout shift.
   */
  async meta(req: Request, res: Response) {
    const requestedPath = (req.params as Record<string, string>)[0] || '';

    const source = resolveSourcePath(requestedPath);
    if (!source) return sendError(res, 'Invalid image path', 400);
    if (!fs.existsSync(source)) return sendError(res, 'Image not found', 404);

    const [metadata, lqip] = await Promise.all([readImageMetadata(source), getLqip(source)]);

    res.setHeader('Cache-Control', CACHE_CONTROL_IMMUTABLE);
    res.setHeader('Access-Control-Allow-Origin', '*');

    return sendSuccess(
      res,
      {
        path: path.posix.normalize(requestedPath),
        width: metadata?.width ?? null,
        height: metadata?.height ?? null,
        format: metadata?.format ?? null,
        bytes: metadata?.size ?? null,
        lqip,
      },
      'Image metadata'
    );
  }
}

export const imageController = new ImageController();
