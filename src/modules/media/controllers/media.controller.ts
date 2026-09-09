import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { getImageUrl, deleteFile, optimizeImage } from '../../../utils/upload';
import path from 'path';
import { config } from '../../../config/env';
import { paginationParams } from '../../../utils/slugify';

export class MediaController {
  async upload(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[];
    const { folder = 'GENERAL', altText } = req.body;

    const media = await Promise.all(
      files.map(async (file) => {
        const url = getImageUrl(file.path);
        return prisma.media.create({
          data: {
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url,
            folder: folder.toUpperCase() as any,
            altText,
            uploadedBy: req.user?.userId,
          },
        });
      })
    );

    return sendSuccess(res, media, 'Files uploaded', 201);
  }

  async getAll(req: Request, res: Response) {
    const { page, limit, folder } = req.query as Record<string, string>;
    const { skip } = paginationParams(page, limit);
    const where: any = {};
    if (folder) where.folder = folder.toUpperCase();

    const parsedPage  = parseInt(page  || '1');
    const parsedLimit = parseInt(limit || '30');

    const [media, total] = await Promise.all([
      prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parsedLimit }),
      prisma.media.count({ where }),
    ]);

    return sendPaginated(res, media, total, parsedPage, parsedLimit);
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return sendError(res, 'Media not found', 404);

    const filePath = path.join(config.upload.path, media.folder.toLowerCase(), media.filename);
    await deleteFile(filePath);

    await prisma.media.delete({ where: { id } });
    return sendSuccess(res, null, 'Media deleted');
  }
}

export const mediaController = new MediaController();
