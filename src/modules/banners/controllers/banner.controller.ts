import { Request, Response } from 'express';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendPaginated } from '../../../utils/response';
import { deleteUploadByUrl, getImageUrl } from '../../../utils/upload';
import { paginationParams } from '../../../utils/slugify';

// Fixed hero banner resolution

/**
 * Hero framing. These now define the ASPECT the master is cropped to, not
 * its pixel size — pinning the size to 1440 is what made retina heroes soft.
 */
const HERO_W = 1440;
const HERO_H = 560;

export class BannerController {
  async getByType(req: Request, res: Response) {
    const { type } = req.params;
    const { gender } = req.query as Record<string, string>;

    const where: any = {
      type: type.toUpperCase() as any,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    };

    // Filter by gender: show banners targeted at this gender + ALL
    if (gender && gender.toUpperCase() !== 'ALL') {
      where.gender = { in: [gender.toUpperCase(), 'ALL'] };
    }

    const banners = await prisma.banner.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
    return sendSuccess(res, banners, 'Banners fetched');
  }

  async getAll(req: Request, res: Response) {
    const { type, isActive, page, limit, search } = req.query as Record<string, string>;
    const where: any = {};
    if (type) where.type = type.toUpperCase();
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) where.title = { contains: search };

    const { page: p, limit: l, skip } = paginationParams(page, limit);
    const [data, total] = await Promise.all([
      prisma.banner.findMany({ where, orderBy: { sortOrder: 'asc' }, skip, take: l }),
      prisma.banner.count({ where }),
    ]);
    return sendPaginated(res, data, total, p, l, 'Banners fetched');
  }

  /**
   * Store the banner cropped to the hero framing, at full resolution.
   *
   * The original code cropped every hero to exactly 1440x560 and re-encoded it
   * to WebP q85, deleting the source. The FRAMING was right — a consistent
   * 2.57:1 hero is the design — but pinning the pixel size to 1440 made 1440px
   * the master ceiling, so a 1440px viewport at 2x DPR (2880 needed) got an
   * upscale and every retina screen saw a soft hero. Asking for 1920w or 2560w
   * returned the same bytes as 1440w because there were no more pixels.
   *
   * So the aspect is kept and the resolution is not: the image is cropped to
   * the same 1440:560 ratio the design expects, but at the source's own
   * resolution, capped at 3840 wide. A 3000px upload becomes 3000x1167 — the
   * identical framing, with 2x the detail available to the derivative pipeline.
   *
   * Mobile crops are left alone: they are portrait by definition and are
   * selected by a media query, not cropped to the desktop ratio.
   */
  private async processImage(file: Express.Multer.File, type?: string): Promise<string> {
    const isHero = !type || type.toUpperCase() === 'HERO';
    const isMobileCrop = file.fieldname === 'mobileImage';

    const inputBuffer = fs.readFileSync(file.path);
    const meta = await sharp(inputBuffer).metadata();

    // Beyond this no viewport benefits, only disk and encode time.
    const MASTER_MAX_WIDTH = 3840;
    const needsCrop = isHero && !isMobileCrop;
    const tooWide = (meta.width ?? 0) > MASTER_MAX_WIDTH;

    if (!needsCrop && !tooWide) {
      // Nothing to do — keep exactly what was uploaded.
      return getImageUrl(file.path);
    }

    const base = path.join(path.dirname(file.path), path.basename(file.path, path.extname(file.path)));
    const outPath = `${base}-master.jpg`;

    let pipeline = sharp(inputBuffer).rotate();

    if (needsCrop) {
      // Same 1440:560 framing as before, at whatever resolution the source
      // supports (bounded above). withoutEnlargement keeps a small upload from
      // being inflated into a fake.
      const targetWidth = Math.min(meta.width ?? HERO_W, MASTER_MAX_WIDTH);
      const targetHeight = Math.round(targetWidth * (HERO_H / HERO_W));
      pipeline = pipeline.resize(targetWidth, targetHeight, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      });
    } else if (tooWide) {
      pipeline = pipeline.resize({ width: MASTER_MAX_WIDTH, withoutEnlargement: true });
    }

    await pipeline
      .withMetadata()
      // Near-lossless: this is the archival master, not what visitors receive.
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(outPath);

    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return getImageUrl(outPath);
  }

  private mapBody(body: any) {
    const data: any = { ...body };
    if (data.linkUrl !== undefined) { data.link = data.linkUrl; delete data.linkUrl; }
    if (data.buttonText !== undefined) { data.ctaText = data.buttonText; delete data.buttonText; }
    if (data.isActive !== undefined) data.isActive = data.isActive === 'true' || data.isActive === true;
    if (data.sortOrder !== undefined) data.sortOrder = parseInt(data.sortOrder, 10) || 0;
    if (data.gender !== undefined) data.gender = String(data.gender).toUpperCase();
    if (data.mobileImage === '') delete data.mobileImage;
    return data;
  }

  private filesFrom(req: Request) {
    const grouped = req.files as Record<string, Express.Multer.File[]> | undefined;
    return {
      desktop: grouped?.image?.[0] ?? (req.file as Express.Multer.File | undefined),
      mobile: grouped?.mobileImage?.[0],
    };
  }

  async create(req: Request, res: Response) {
    const data = this.mapBody(req.body);
    const { desktop, mobile } = this.filesFrom(req);
    if (desktop) data.image = await this.processImage(desktop, data.type);
    if (mobile) data.mobileImage = await this.processImage(mobile, data.type);
    const banner = await prisma.banner.create({ data });
    return sendSuccess(res, banner, 'Banner created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const data = this.mapBody(req.body);
    const { desktop, mobile } = this.filesFrom(req);
    if (desktop) data.image = await this.processImage(desktop, data.type);
    if (mobile) data.mobileImage = await this.processImage(mobile, data.type);
    const banner = await prisma.banner.update({ where: { id }, data });
    return sendSuccess(res, banner, 'Banner updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    // Read the artwork before the row goes — a banner master runs to hundreds
    // of KB and there is no way back to the file once the record is deleted.
    const existing = await prisma.banner.findUnique({
      where: { id },
      select: { image: true, mobileImage: true },
    });
    await prisma.banner.delete({ where: { id } });
    if (existing) {
      await deleteUploadByUrl(existing.image);
      await deleteUploadByUrl(existing.mobileImage);
    }
    return sendSuccess(res, null, 'Banner deleted');
  }

  async reorder(req: Request, res: Response) {
    const { items } = req.body;
    await Promise.all(
      items.map((item: { id: string; sortOrder: number }) =>
        prisma.banner.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
      )
    );
    return sendSuccess(res, null, 'Order updated');
  }
}

export const bannerController = new BannerController();
