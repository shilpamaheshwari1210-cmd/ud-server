import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

const run = promisify(execFile);

/**
 * Video inspection and poster extraction, used by the Instagram reel uploads.
 *
 * Reels play in a 240px-wide 9:16 tile, so a low-resolution upload is stretched
 * on high-DPR screens exactly the way undersized product photos were. ffprobe
 * gives us the real dimensions before the file is accepted, and ffmpeg lets us
 * pull the poster straight from the video so the admin only has to supply one
 * file.
 *
 * Every function degrades gracefully when ffmpeg is missing: probing returns
 * null and poster extraction returns null, so uploads still succeed — they just
 * lose the extra validation and convenience.
 */

/** Matches the poster minimum: 240px tile x 3 for high-DPR screens. */
export const MIN_VIDEO_WIDTH = 720;

let ffmpegAvailable: boolean | null = null;

export const hasFfmpeg = async (): Promise<boolean> => {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await run('ffprobe', ['-version']);
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
    logger.warn('ffmpeg/ffprobe not found — reel videos will not be probed or auto-postered');
  }
  return ffmpegAvailable;
};

export interface VideoInfo {
  width: number;
  height: number;
  durationSeconds: number;
}

/** Read dimensions and duration. Returns null if ffprobe is unavailable or the file is unreadable. */
export const probeVideo = async (absolutePath: string): Promise<VideoInfo | null> => {
  if (!(await hasFfmpeg())) return null;
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      absolutePath,
    ], { timeout: 30_000 });

    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) return null;

    return {
      width: Number(stream.width),
      height: Number(stream.height),
      durationSeconds: Number(parsed.format?.duration) || 0,
    };
  } catch (error) {
    logger.warn(`ffprobe failed for ${path.basename(absolutePath)}: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Extract a poster frame.
 *
 * Sampled one second in rather than at 0s: the opening frame of a reel is very
 * often a fade from black, which makes a useless thumbnail. Falls back to the
 * first frame for clips shorter than that.
 */
export const extractPoster = async (
  videoPath: string,
  outputPath: string
): Promise<string | null> => {
  if (!(await hasFfmpeg())) return null;

  const info = await probeVideo(videoPath);
  const seek = info && info.durationSeconds > 1.5 ? '1' : '0';

  try {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await run('ffmpeg', [
      '-ss', seek,
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',          // high-quality JPEG
      '-y',                 // overwrite
      outputPath,
    ], { timeout: 60_000 });

    if (!fs.existsSync(outputPath)) return null;
    return outputPath;
  } catch (error) {
    logger.warn(`Poster extraction failed for ${path.basename(videoPath)}: ${(error as Error).message}`);
    return null;
  }
};

export interface VideoCheck {
  ok: boolean;
  info: VideoInfo | null;
  message?: string;
}

/**
 * Reject videos too small to render sharply in the reel tile. Skipped entirely
 * when ffmpeg is unavailable — better to accept the upload than to block the
 * feature on a missing binary.
 */
export const checkVideoResolution = async (absolutePath: string): Promise<VideoCheck> => {
  const info = await probeVideo(absolutePath);

  if (!info) {
    // `probeVideo` returns null for two very different reasons, and treating
    // them the same let unplayable files through: with ffmpeg absent there is
    // simply nothing to check, but with ffmpeg present a file it cannot read
    // is a file no browser will play either. The upload is now refused rather
    // than stored as a reel that renders a black tile.
    if (await hasFfmpeg()) {
      return {
        ok: false,
        info: null,
        message:
          'That file could not be read as a video. Upload the original clip — ' +
          'MP4 or MOV works best. A renamed file or a partial download will fail here.',
      };
    }
    return { ok: true, info: null };
  }

  if (info.width < MIN_VIDEO_WIDTH) {
    return {
      ok: false,
      info,
      message:
        `Video is only ${info.width}x${info.height}. Reels need at least ${MIN_VIDEO_WIDTH}px wide ` +
        `or they look blurry on phones and retina screens. Upload the original file rather than a ` +
        `screen recording or a re-download.`,
    };
  }

  return { ok: true, info };
};

/**
 * Re-encode an uploaded reel into a web-delivery rendition.
 *
 * Reels are recorded at 1080x1920 and can run to tens of megabytes, but the
 * homepage tile is 240px wide — serving the original means a visitor downloads
 * roughly twenty times the pixels they can see, and playback stalls while it
 * buffers. This produces one rendition sized for the tile that starts playing
 * almost immediately.
 *
 * Settings and why:
 *   scale to <=720px   240px tile x 3 for high-DPR screens; -2 keeps the
 *                      aspect and forces an even height (H.264 requires it)
 *   H.264 + yuv420p    the only combination every browser and iOS decodes
 *   crf 26             visually clean at this display size; lower is wasted
 *   +faststart         moves the index to the front so the browser can start
 *                      playing before the file finishes downloading. Without
 *                      this a progressive MP4 waits for the whole file.
 *   aac 64k            kept so the unmute control still works; tiles start muted
 *
 * Returns null on failure, so the caller can fall back to the original upload.
 */
export const optimizeVideoForWeb = async (
  inputPath: string,
  outputPath: string,
  maxWidth = 720
): Promise<string | null> => {
  if (!(await hasFfmpeg())) return null;

  try {
    await run('ffmpeg', [
      '-i', inputPath,
      '-vf', `scale='min(${maxWidth},iw)':-2`,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '26',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], { timeout: 300_000, maxBuffer: 1024 * 1024 * 8 });

    if (!fs.existsSync(outputPath)) return null;
    return outputPath;
  } catch (error) {
    logger.warn(`Video optimisation failed for ${path.basename(inputPath)}: ${(error as Error).message}`);
    return null;
  }
};
