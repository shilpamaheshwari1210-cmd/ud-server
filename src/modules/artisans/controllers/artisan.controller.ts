import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';

/**
 * Artisan admin CRUD — see
 * documentation/docs/architecture/phase-2-handicraft-domain-spec.md.
 *
 * Unlike Material/Style/Room, Artisan has no slug in the spec's model. It now
 * has a real public directory (`GET /`) plus a bio page (`GET /:id`) — see
 * phase-4-experience-spec.md §3 (Product Storytelling). Fields: name, bio,
 * photo, region, isActive.
 */
export class ArtisanController {
  /** Public: every active artisan, for the storefront directory. */
  async getAll(_req: Request, res: Response) {
    const artisans = await prisma.artisan.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }],
    });
    return sendSuccess(res, artisans, 'Artisans fetched');
  }

  /** Public: a single active artisan, for the artisan bio page. */
  async getById(req: Request, res: Response) {
    const { id } = req.params;
    const artisan = await prisma.artisan.findFirst({ where: { id, isActive: true } });
    if (!artisan) return sendError(res, 'Artisan not found', 404);
    return sendSuccess(res, artisan, 'Artisan fetched');
  }

  /** Admin: every artisan, active or not. */
  async getAllAdmin(_req: Request, res: Response) {
    const artisans = await prisma.artisan.findMany({ orderBy: [{ name: 'asc' }] });
    return sendSuccess(res, artisans, 'Artisans fetched');
  }

  async create(req: Request, res: Response) {
    const body: any = { ...req.body };
    if (!String(body.name ?? '').trim()) return sendError(res, 'name is required', 422);

    const artisan = await prisma.artisan.create({
      data: {
        name: String(body.name).trim(),
        bio: body.bio ?? null,
        photo: body.photo ?? null,
        region: body.region ?? null,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive === true || body.isActive === 'true'),
      },
    });
    return sendSuccess(res, artisan, 'Artisan created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.artisan.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Artisan not found', 404);

    const body: any = { ...req.body };
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.bio !== undefined) data.bio = body.bio || null;
    if (body.photo !== undefined) data.photo = body.photo || null;
    if (body.region !== undefined) data.region = body.region || null;
    if (body.isActive !== undefined) data.isActive = body.isActive === true || body.isActive === 'true';

    const artisan = await prisma.artisan.update({ where: { id }, data });
    return sendSuccess(res, artisan, 'Artisan updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.artisan.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Artisan not found', 404);

    // Products referencing this artisan are not blocked or cascaded — the FK
    // is ON DELETE SET NULL, matching Material/Style/Room and Country.
    await prisma.artisan.delete({ where: { id } });
    return sendSuccess(res, null, 'Artisan deleted');
  }
}

export const artisanController = new ArtisanController();
