import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import fs from 'fs';
import path from 'path';
import { getImageUrl, deleteUploadByUrl, discardUploads } from '../../../utils/upload';
import { checkVideoResolution, extractPoster, optimizeVideoForWeb } from '../../../utils/video';
import { logger } from '../../../utils/logger';


/**
 * The three audiences a reel can be aimed at.
 *
 * "ALL" is the default and the safe one: an untagged reel keeps showing on
 * both storefronts exactly as it did before this field existed, so adding
 * gender targeting cannot silently empty anyone's reel row.
 *
 * Anything unrecognised falls back to ALL rather than 400-ing — a typo in the
 * payload should not be able to hide a reel from every shopper.
 */
const REEL_GENDERS = ['ALL', 'WOMEN', 'MEN'] as const;
type ReelGender = (typeof REEL_GENDERS)[number];

const normaliseGender = (value: unknown): ReelGender | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const upper = String(value).trim().toUpperCase();
  return (REEL_GENDERS as readonly string[]).includes(upper)
    ? (upper as ReelGender)
    : 'ALL';
};

/**
 * Resolve videoUrl / thumbnail from either an uploaded file or a pasted URL.
 * A file always wins over a URL typed in the same submission.
 *
 * Booleans and numbers arrive as strings when the request is multipart, so they
 * are coerced here rather than trusted as-is.
 */
const resolveMedia = async (req: Request) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const videoFile = files?.video?.[0];
  const thumbFile = files?.thumbnail?.[0];

  const body = req.body as Record<string, any>;
  const bool = (v: any) =>
    v === undefined ? undefined : v === true || v === 'true';

  let videoUrl = videoFile ? getImageUrl(videoFile.path) : body.videoUrl;
  let thumbnail = thumbFile ? getImageUrl(thumbFile.path) : body.thumbnail;

  if (videoFile) {
    // A reel tile is 240px wide at 3x DPR, so anything under 720px is stretched
    // and looks soft — the same failure mode as undersized product photos.
    const check = await checkVideoResolution(videoFile.path);
    if (!check.ok) {
      await fs.promises.unlink(videoFile.path).catch(() => {});
      if (thumbFile) await fs.promises.unlink(thumbFile.path).catch(() => {});
      return { error: check.message };
    }
    // Deliberately no transcode here — see finaliseReelMedia.
  }

  return {
    videoUrl,
    thumbnail,
    isActive: bool(body.isActive),
    sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
    gender: normaliseGender(body.gender),
    // Handed to the background step once the response is out.
    videoPath: videoFile?.path,
    hasCustomThumb: Boolean(thumbFile || body.thumbnail),
  };
};

/**
 * Re-encode a reel for delivery, AFTER the response has been sent.
 *
 * This used to run inside the request, which made the admin wait for ffmpeg
 * before getting any answer. A 53 MB clip takes far longer than the browser's
 * 30 second request timeout, so the upload was cancelled client-side every
 * time — and because the cancel tore down the handler mid-flight, the reel row
 * was never written while the uploaded file stayed on disk. Three orphaned
 * videos totalling 153 MB accumulated that way, one of them with a perfectly
 * good rendition beside it that nothing ever pointed at.
 *
 * So the reel is saved immediately with the original file, which is already
 * playable, and this swaps in the smaller rendition when it is ready. Failure
 * is survivable by design: the reel keeps playing the original.
 */
const finaliseReelMedia = async (
  reelId: string,
  videoPath: string,
  needsPoster: boolean
): Promise<void> => {
  try {
    const webPath = videoPath.replace(/\.[^.]+$/, '-web.mp4');
    const optimised = await optimizeVideoForWeb(videoPath, webPath);
    const playablePath = optimised ?? videoPath;

    const data: { videoUrl?: string; thumbnail?: string } = {};
    if (optimised && optimised !== videoPath) data.videoUrl = getImageUrl(optimised);

    if (needsPoster) {
      const posterPath = playablePath.replace(/\.[^.]+$/, '-poster.jpg');
      const made = await extractPoster(playablePath, posterPath);
      if (made) data.thumbnail = getImageUrl(made);
    }

    if (Object.keys(data).length) {
      await prisma.instagramReel.update({ where: { id: reelId }, data });
    }

    // Only after the row points at the rendition — otherwise a crash between
    // the two would leave the reel referencing a file that no longer exists.
    if (optimised && optimised !== videoPath) {
      await fs.promises.unlink(videoPath).catch(() => {});
    }
    logger.info(`Reel ${reelId}: media finalised`);
  } catch (error) {
    // The reel is already live on the original upload; log and leave it.
    logger.warn(`Reel ${reelId}: media finalisation failed — ${(error as Error).message}`);
  }
};

export class InstagramReelsController {
  // ── Public: get active reels for homepage ─────────────────────
  async getActive(req: Request, res: Response) {
    try {
      // A reel is only displayable if it has its own video — that is what the
      // tile plays. Rows created before the video became mandatory would
      // otherwise render as empty black tiles on the homepage, so they are
      // withheld from the storefront rather than shown broken. The admin
      // listing still returns everything so they can be fixed or removed.
      // Reels aimed at this storefront, plus the untargeted ones. Asking for
      // ALL (or asking for nothing) means "no preference expressed", which
      // returns every reel rather than only the untargeted ones — otherwise a
      // shopper who has not picked a side would lose the gendered reels.
      const requested = normaliseGender((req.query as Record<string, string>).gender);
      const where: any = { isActive: true, videoUrl: { not: null } };
      if (requested && requested !== 'ALL') {
        where.gender = { in: [requested, 'ALL'] };
      }

      const reels = await prisma.instagramReel.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ success: true, data: reels });
    } catch (err) {
      logger.error(`Reel fetch failed: ${(err as Error).message}`);
      res.status(500).json({ success: false, message: 'Failed to fetch reels' });
    }
  }

  // ── Admin: get all reels ───────────────────────────────────────
  async getAll(req: Request, res: Response) {
    try {
      // The admin filter is an exact match, not the storefront's
      // "this gender + ALL" union: someone reviewing the Men reels wants the
      // rows tagged MEN, not every row a man happens to see.
      const { gender, isActive } = req.query as Record<string, string>;
      const where: any = {};
      const wanted = normaliseGender(gender);
      if (wanted && String(gender).trim().toUpperCase() === wanted) where.gender = wanted;
      if (isActive !== undefined) where.isActive = isActive === 'true';

      const reels = await prisma.instagramReel.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ success: true, data: reels });
    } catch (err) {
      logger.error(`Reel fetch failed: ${(err as Error).message}`);
      res.status(500).json({ success: false, message: 'Failed to fetch reels' });
    }
  }

  // ── Admin: create reel ─────────────────────────────────────────
  async create(req: Request, res: Response) {
    try {
      const { title, caption, reelUrl } = req.body;
      const media = await resolveMedia(req);
      if ('error' in media && media.error) {
        return res.status(400).json({ success: false, message: media.error });
      }
      // The video IS the reel now — the Instagram embed cannot be styled into
      // the tile, so a reel without its own video has nothing to play.
      if (!media.videoUrl) {
        // A poster may already be on disk from this same request; without this
        // a rejected submission leaves it there with nothing pointing at it.
        await discardUploads(req);
        return res.status(400).json({ success: false, message: 'A video file is required.' });
      }
      const reel = await prisma.instagramReel.create({
        data: {
          title: title || null,
          caption: caption || null,
          reelUrl: reelUrl || '',
          videoUrl: media.videoUrl || null,
          thumbnail: media.thumbnail || null,
          isActive: media.isActive !== false,
          sortOrder: media.sortOrder ?? 0,
          gender: media.gender ?? 'ALL',
        },
      });
      res.status(201).json({ success: true, data: reel });

      // Answer first, encode after: the admin gets a saved reel in seconds
      // instead of waiting out ffmpeg behind a request that times out.
      if (media.videoPath) {
        void finaliseReelMedia(reel.id, media.videoPath, !media.hasCustomThumb);
      }
    } catch (err) {
      logger.error(`Reel create failed: ${(err as Error).message}`, { stack: (err as Error).stack });
      await discardUploads(req);
      res.status(500).json({ success: false, message: 'Failed to create reel' });
    }
  }

  // ── Admin: update reel ─────────────────────────────────────────
  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { title, caption, reelUrl } = req.body;
      const media = await resolveMedia(req);
      if ('error' in media && media.error) {
        return res.status(400).json({ success: false, message: media.error });
      }
      // Capture the outgoing media so a replaced video or poster does not
      // linger on disk unreferenced.
      const previous = await prisma.instagramReel.findUnique({
        where: { id },
        select: { videoUrl: true, thumbnail: true },
      });

      const reel = await prisma.instagramReel.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(caption !== undefined && { caption }),
          ...(reelUrl !== undefined && { reelUrl }),
          ...(media.videoUrl !== undefined && { videoUrl: media.videoUrl || null }),
          ...(media.thumbnail !== undefined && { thumbnail: media.thumbnail || null }),
          ...(media.isActive !== undefined && { isActive: media.isActive }),
          ...(media.sortOrder !== undefined && { sortOrder: media.sortOrder }),
          ...(media.gender !== undefined && { gender: media.gender }),
        },
      });
      res.json({ success: true, data: reel });

      // Only once the row points elsewhere.
      if (previous?.videoUrl && reel.videoUrl !== previous.videoUrl) {
        await deleteUploadByUrl(previous.videoUrl);
      }
      if (previous?.thumbnail && reel.thumbnail !== previous.thumbnail) {
        await deleteUploadByUrl(previous.thumbnail);
      }

      if (media.videoPath) {
        void finaliseReelMedia(reel.id, media.videoPath, !media.hasCustomThumb);
      }
    } catch (err) {
      logger.error(`Reel update failed: ${(err as Error).message}`, { stack: (err as Error).stack });
      await discardUploads(req);
      res.status(500).json({ success: false, message: 'Failed to update reel' });
    }
  }

  // ── Admin: delete reel ─────────────────────────────────────────
  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      // Read the media before the row goes, otherwise the only pointer to the
      // files on disk is gone and they are orphaned for good.
      const existing = await prisma.instagramReel.findUnique({
        where: { id },
        select: { videoUrl: true, thumbnail: true },
      });
      await prisma.instagramReel.delete({ where: { id } });
      if (existing) {
        await deleteUploadByUrl(existing.videoUrl);
        await deleteUploadByUrl(existing.thumbnail);
      }
      res.json({ success: true, message: 'Reel deleted' });
    } catch (err) {
      logger.error(`Reel delete failed: ${(err as Error).message}`);
      res.status(500).json({ success: false, message: 'Failed to delete reel' });
    }
  }

  // ── Admin: bulk reorder ────────────────────────────────────────
  async reorder(req: Request, res: Response) {
    try {
      const { order }: { order: { id: string; sortOrder: number }[] } = req.body;
      await prisma.$transaction(
        order.map(({ id, sortOrder }) =>
          prisma.instagramReel.update({ where: { id }, data: { sortOrder } })
        )
      );
      res.json({ success: true });
    } catch (err) {
      logger.error(`Reel reorder failed: ${(err as Error).message}`);
      res.status(500).json({ success: false, message: 'Failed to reorder reels' });
    }
  }
}

export default new InstagramReelsController();
