import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import controller from '../controllers/instagram-reels.controller';
import { authenticate, isAdminOrSubAdmin } from '../../../middlewares/auth.middleware';
import { createUploader, VIDEO_MIME_TYPES, validateUploadResolution } from '../../../utils/upload';
import { config } from '../../../config/env';

const router = Router();

/**
 * Reels accept an optional video and poster image.
 *
 * Why this exists: Instagram has closed down oEmbed and its /embed/ iframe now
 * serves a login wall with no media in it, so a reel identified only by URL
 * renders as a dead grey box on the storefront. Hosting the clip ourselves is
 * the only way to actually show it, and the storefront already prefers
 * `videoUrl` (a real autoplaying <video>) over the embed when one is present.
 *
 * The ceiling is deliberately generous. A phone records a 30s vertical reel at
 * 1080p60 or 4K and lands well past 60 MB, which is where uploads were being
 * refused — and the original is temporary anyway: `finaliseReelMedia` transcodes
 * it down to a ~720p rendition and deletes the source, so a large upload costs
 * disk only for the length of the encode, not forever.
 *
 * Keep nginx's `client_max_body_size` above this or nginx rejects the request
 * before Express ever sees it, and the admin gets a bare 413 with no message.
 */
const MAX_VIDEO_BYTES = parseInt(process.env.MAX_VIDEO_SIZE || '209715200', 10); // 200 MB

const upload = createUploader('reels', MAX_VIDEO_BYTES, [
  ...VIDEO_MIME_TYPES,
  ...config.upload.allowedTypes,
]);

const acceptMedia = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

/** Turn multer rejections into a clear 400 rather than a generic 500. */
const handleMedia = (req: Request, res: Response, next: NextFunction) => {
  acceptMedia(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `File is too large. Maximum video size is ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB.`,
        });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    return next();
  });
};

/**
 * A reel card renders 240px wide at 9:16 on desktop, so a poster needs ~720px
 * to stay sharp on a high-DPR screen. Without this a 200px screenshot would be
 * accepted and then stretched 3.6x — the same blur problem as product images.
 */
const checkPoster = validateUploadResolution('reels');

// Public
router.get('/', controller.getActive.bind(controller));

// Admin
router.get('/admin', authenticate, isAdminOrSubAdmin, controller.getAll.bind(controller));
// checkPoster only inspects image files — the video in the same request is
// skipped, since it has no resolution Sharp can read.
router.post('/', authenticate, isAdminOrSubAdmin, handleMedia, checkPoster, controller.create.bind(controller));
router.patch('/reorder', authenticate, isAdminOrSubAdmin, controller.reorder.bind(controller));
router.put('/:id', authenticate, isAdminOrSubAdmin, handleMedia, checkPoster, controller.update.bind(controller));
router.delete('/:id', authenticate, isAdminOrSubAdmin, controller.delete.bind(controller));

export default router;
