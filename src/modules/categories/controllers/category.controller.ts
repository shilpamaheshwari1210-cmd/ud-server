import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { createSlug, paginationParams } from '../../../utils/slugify';
import { getImageUrl } from '../../../utils/upload';
import { AppError } from '../../../middlewares/error.middleware';

export class CategoryController {

  async getAll(req: Request, res: Response) {
    const { parentOnly, withProducts, page, limit, search } = req.query as Record<string, string>;

    // Public storefront call (no page param) → return all active, flat list
    if (page === undefined) {
      const where: any = { isActive: true, deletedAt: null };
      if (parentOnly === 'true') where.parentId = null;
      if (search) where.name = { contains: search };

      const categories = await prisma.category.findMany({
        where,
        include: {
          children: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
          ...(withProducts === 'true' && {
            products: {
              where: { isActive: true, deletedAt: null },
              take: 4,
              include: { images: { where: { isPrimary: true }, take: 1 } },
            },
          }),
          _count: { select: { products: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return sendSuccess(res, categories, 'Categories fetched');
    }

    // Admin paginated call
    const { page: p, limit: l, skip } = paginationParams(page, limit);
    const where: any = { deletedAt: null };
    if (search) where.name = { contains: search };

    const [data, total] = await Promise.all([
      prisma.category.findMany({
        where,
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { products: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip,
        take: l,
      }),
      prisma.category.count({ where }),
    ]);

    return sendPaginated(res, data, total, p, l, 'Categories fetched');
  }

  // Lightweight hierarchical nav menu for the storefront
  // Returns all nav categories with gender field included (client filters by active gender)
  async getNavMenu(req: Request, res: Response) {
    const categories = await prisma.category.findMany({
      where: { isActive: true, showInNav: true, parentId: null, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id:     true,
        name:   true,
        slug:   true,
        image:  true,
        gender: true,
        children: {
          where: { isActive: true, showInNav: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, slug: true, gender: true },
        },
      },
    });
    return sendSuccess(res, categories, 'Nav menu fetched');
  }

  async getBySlug(req: Request, res: Response) {
    const { slug } = req.params;
    const category = await prisma.category.findFirst({
      where: { slug, isActive: true },
      include: {
        children: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        parent:   { select: { id: true, name: true, slug: true } },
        _count:   { select: { products: true } },
      },
    });
    if (!category) return sendError(res, 'Category not found', 404);
    return sendSuccess(res, category, 'Category fetched');
  }

  // Returns all top-level (parent) categories for dropdowns
  async getParents(req: Request, res: Response) {
    const categories = await prisma.category.findMany({
      where: { parentId: null, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true },
    });
    return sendSuccess(res, categories, 'Parent categories');
  }

  // Home page categories — only showOnHome=true, optional gender filter
  async getHomeCategories(req: Request, res: Response) {
    const { gender } = req.query as Record<string, string>;
    const where: any = { isActive: true, showOnHome: true, deletedAt: null };
    if (gender && gender !== 'ALL') {
      where.OR = [{ gender }, { gender: null }];
    }
    const categories = await prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, slug: true, image: true, gender: true,
        _count: { select: { products: true } },
      },
    });
    return sendSuccess(res, categories, 'Home categories fetched');
  }

  private mapBody(body: any, file?: Express.Multer.File) {
    const data: any = { ...body };
    if (file) data.image = getImageUrl(file.path);
    if (data.metaDescription !== undefined) { data.metaDesc = data.metaDescription; delete data.metaDescription; }
    if (data.isActive    !== undefined) data.isActive    = data.isActive    === 'true' || data.isActive    === true;
    if (data.isFeatured  !== undefined) data.isFeatured  = data.isFeatured  === 'true' || data.isFeatured  === true;
    if (data.showInNav   !== undefined) data.showInNav   = data.showInNav   === 'true' || data.showInNav   === true;
    if (data.showOnHome  !== undefined) data.showOnHome  = data.showOnHome  === 'true' || data.showOnHome  === true;
    if (data.sortOrder   !== undefined) data.sortOrder   = parseInt(data.sortOrder, 10) || 0;
    if (data.gender      !== undefined) data.gender      = data.gender || null;
    // parentId: empty string → null
    if (data.parentId !== undefined) data.parentId = data.parentId || null;
    return data;
  }

  async create(req: Request, res: Response) {
    const data = this.mapBody(req.body, req.file);
    if (!data.slug) data.slug = createSlug(data.name);
    const category = await prisma.category.create({ data });
    return sendSuccess(res, category, 'Category created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) throw new AppError('Category not found', 404);
    const data = this.mapBody(req.body, req.file);
    const category = await prisma.category.update({ where: { id }, data });
    return sendSuccess(res, category, 'Category updated');
  }

  /**
   * Bulk-set the menu position of several categories in one save.
   *
   * The mega menu already ordered by `sortOrder`; what was missing was a way
   * to set it without opening each category's edit dialog one at a time, which
   * is why every category sat at 0 and the menu came out in creation order.
   *
   * Lower shows first, matching every other `sortOrder` in the schema — and
   * deliberately the opposite of `Product.sortOrder`, which is a priority where
   * higher wins. The two are never edited on the same screen.
   */
  async updatePositions(req: Request, res: Response) {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const clean = items
      .filter((i: any) => i && typeof i.id === 'string' && Number.isFinite(Number(i.sortOrder)))
      .map((i: any) => ({ id: i.id, sortOrder: Math.trunc(Number(i.sortOrder)) }));

    if (!clean.length) return sendSuccess(res, { updated: 0 }, 'Nothing to update');

    // updateMany, not update: an id deleted by a concurrent edit should be a
    // no-op row, not a failure that rolls back everyone else's positions.
    await prisma.$transaction(
      clean.map((i: { id: string; sortOrder: number }) =>
        prisma.category.updateMany({
          where: { id: i.id, deletedAt: null },
          data: { sortOrder: i.sortOrder },
        })
      )
    );
    return sendSuccess(res, { updated: clean.length }, 'Menu order updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    await prisma.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return sendSuccess(res, null, 'Category deleted');
  }

  async getFeatured(req: Request, res: Response) {
    const { limit } = req.query;
    const take = Math.min(50, parseInt(String(limit || 12), 10));
    const categories = await prisma.category.findMany({
      where: { isActive: true, isFeatured: true, parentId: null, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take,
      include: { _count: { select: { products: true } } },
    });
    return sendSuccess(res, categories, 'Featured categories');
  }
}

export const categoryController = new CategoryController();
