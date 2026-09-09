import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { optimizeImage, getImageUrl, deleteFile } from '../../../utils/upload';

class StoreController {

  // GET /stores — public, active only
  async getAll(req: Request, res: Response) {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: stores });
  }

  // GET /stores/admin — all stores
  async getAllAdmin(req: Request, res: Response) {
    const stores = await prisma.store.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: stores });
  }

  // POST /stores — create
  async create(req: Request, res: Response) {
    const { name, address, city, phone, email, hours, mapLink, isActive, sortOrder } = req.body;

    let imageUrl: string | undefined;
    if (req.file) {
      const optimized = await optimizeImage(req.file.path, undefined, { width: 800, quality: 85 });
      imageUrl = getImageUrl(optimized);
    }

    const store = await prisma.store.create({
      data: {
        name,
        address,
        city:      city      || undefined,
        phone:     phone     || undefined,
        email:     email     || undefined,
        hours:     hours     || undefined,
        mapLink:   mapLink   || undefined,
        image:     imageUrl  || undefined,
        isActive:  isActive !== undefined ? (isActive === 'true' || isActive === true) : true,
        sortOrder: sortOrder ? Number(sortOrder) : 0,
      },
    });
    res.status(201).json({ success: true, data: store });
  }

  // PUT /stores/:id — update
  async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name, address, city, phone, email, hours, mapLink, isActive, sortOrder } = req.body;

    let imageUrl: string | undefined;
    if (req.file) {
      // Delete old image if exists
      const existing = await prisma.store.findUnique({ where: { id }, select: { image: true } });
      if (existing?.image) {
        // Try to delete old file (best-effort)
        const rel = existing.image.replace(/^.*\/uploads\//, '');
        await deleteFile(require('path').join(require('../../../config/env').config.upload.path, rel)).catch(() => {});
      }
      const optimized = await optimizeImage(req.file.path, undefined, { width: 800, quality: 85 });
      imageUrl = getImageUrl(optimized);
    }

    const store = await prisma.store.update({
      where: { id },
      data: {
        ...(name      !== undefined && { name }),
        ...(address   !== undefined && { address }),
        ...(city      !== undefined && { city: city || null }),
        ...(phone     !== undefined && { phone: phone || null }),
        ...(email     !== undefined && { email: email || null }),
        ...(hours     !== undefined && { hours: hours || null }),
        ...(mapLink   !== undefined && { mapLink: mapLink || null }),
        ...(imageUrl  !== undefined && { image: imageUrl }),
        ...(isActive  !== undefined && { isActive: isActive === 'true' || isActive === true }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
      },
    });
    res.json({ success: true, data: store });
  }

  // DELETE /stores/:id
  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const store = await prisma.store.findUnique({ where: { id }, select: { image: true } });
    if (store?.image) {
      const rel = store.image.replace(/^.*\/uploads\//, '');
      await deleteFile(require('path').join(require('../../../config/env').config.upload.path, rel)).catch(() => {});
    }
    await prisma.store.delete({ where: { id } });
    res.json({ success: true, message: 'Store deleted' });
  }

  // PUT /stores/reorder
  async reorder(req: Request, res: Response) {
    const { items } = req.body as { items: { id: string; sortOrder: number }[] };
    await Promise.all(items.map(({ id, sortOrder }) =>
      prisma.store.update({ where: { id }, data: { sortOrder } }),
    ));
    res.json({ success: true });
  }
}

export const storeController = new StoreController();
