import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';
import { createSlug } from '../../../utils/slugify';

/**
 * Room admin CRUD — see
 * documentation/docs/architecture/phase-2-handicraft-domain-spec.md.
 * Shaped like `Category`: id, name, slug, description, image, sortOrder,
 * isActive. Public reads only ever see `isActive: true` rows.
 */
export class RoomController {
  /** Public: active rooms only, for storefront filters/facets. */
  async getAll(_req: Request, res: Response) {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return sendSuccess(res, rooms, 'Rooms fetched');
  }

  async getBySlug(req: Request, res: Response) {
    const { slug } = req.params;
    const room = await prisma.room.findFirst({ where: { slug, isActive: true } });
    if (!room) return sendError(res, 'Room not found', 404);
    return sendSuccess(res, room, 'Room fetched');
  }

  /** Admin: every room, active or not. */
  async getAllAdmin(_req: Request, res: Response) {
    const rooms = await prisma.room.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return sendSuccess(res, rooms, 'Rooms fetched');
  }

  async create(req: Request, res: Response) {
    const body: any = { ...req.body };
    if (!String(body.name ?? '').trim()) return sendError(res, 'name is required', 422);

    const slug = body.slug ? createSlug(String(body.slug)) : createSlug(String(body.name));
    const existing = await prisma.room.findUnique({ where: { slug } });
    if (existing) return sendError(res, `Room slug "${slug}" already exists`, 409);

    const room = await prisma.room.create({
      data: {
        name: String(body.name).trim(),
        slug,
        description: body.description ?? null,
        image: body.image ?? null,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive === true || body.isActive === 'true'),
        sortOrder: body.sortOrder !== undefined ? parseInt(body.sortOrder, 10) || 0 : 0,
      },
    });
    return sendSuccess(res, room, 'Room created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.room.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Room not found', 404);

    const body: any = { ...req.body };
    const data: any = {};

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.slug !== undefined) {
      const slug = createSlug(String(body.slug));
      const clash = await prisma.room.findFirst({ where: { slug, NOT: { id } } });
      if (clash) return sendError(res, `Room slug "${slug}" already exists`, 409);
      data.slug = slug;
    }
    if (body.description !== undefined) data.description = body.description || null;
    if (body.image !== undefined) data.image = body.image || null;
    if (body.isActive !== undefined) data.isActive = body.isActive === true || body.isActive === 'true';
    if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder, 10) || 0;

    const room = await prisma.room.update({ where: { id }, data });
    return sendSuccess(res, room, 'Room updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.room.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Room not found', 404);

    // Products referencing this room are not blocked or cascaded — the FK
    // is ON DELETE SET NULL, matching Country's nullable-override pattern.
    await prisma.room.delete({ where: { id } });
    return sendSuccess(res, null, 'Room deleted');
  }
}

export const roomController = new RoomController();
