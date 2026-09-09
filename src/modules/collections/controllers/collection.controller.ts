import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { createSlug, paginationParams } from '../../../utils/slugify';
import { getImageUrl, deleteUploadByUrl } from '../../../utils/upload';

/**
 * Pull the uploaded files out of a multipart request.
 *
 * The route moved from `upload.single('image')` to `upload.fields([...])` so a
 * collection can carry both a card image and a wide hero banner, which changes
 * `req.file` into a keyed `req.files`. Both shapes are handled because the
 * admin form is the only caller and a stale bundle would otherwise silently
 * stop saving images.
 */
const pickFiles = (req: Request) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    image: files?.image?.[0] ?? (req as any).file,
    bannerImage: files?.bannerImage?.[0],
  };
};

export class CollectionController {
  async getAll(req: Request, res: Response) {
    const { page, limit, search } = req.query as Record<string, string>;

    if (page === undefined) {
      const collections = await prisma.collection.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { products: true } } },
      });
      return sendSuccess(res, collections, 'Collections fetched');
    }

    const where: any = {};
    if (search) where.name = { contains: search };

    const { page: p, limit: l, skip } = paginationParams(page, limit);
    const [data, total] = await Promise.all([
      prisma.collection.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: { sortOrder: 'asc' },
        skip,
        take: l,
      }),
      prisma.collection.count({ where }),
    ]);
    return sendPaginated(res, data, total, p, l, 'Collections fetched');
  }

  async getBySlug(req: Request, res: Response) {
    const { slug } = req.params;
    const collection = await prisma.collection.findUnique({
      where: { slug },
      include: { _count: { select: { products: true } } },
    });
    if (!collection) return sendError(res, 'Collection not found', 404);
    return sendSuccess(res, collection, 'Collection fetched');
  }

  async create(req: Request, res: Response) {
    const { image, bannerImage } = pickFiles(req);
    const data: any = { ...req.body };
    if (!data.slug) data.slug = createSlug(data.name);
    if (image) data.image = getImageUrl(image.path);
    if (bannerImage) data.bannerImage = getImageUrl(bannerImage.path);
    if (data.isActive !== undefined) data.isActive = data.isActive === 'true' || data.isActive === true;
    if (data.isFeatured !== undefined) data.isFeatured = data.isFeatured === 'true' || data.isFeatured === true;
    if (data.sortOrder !== undefined) data.sortOrder = parseInt(data.sortOrder, 10);
    const collection = await prisma.collection.create({ data });
    return sendSuccess(res, collection, 'Collection created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const { image, bannerImage } = pickFiles(req);
    const data: any = { ...req.body };

    const existing = await prisma.collection.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Collection not found', 404);

    /**
     * Follow the name when it changes.
     *
     * Only `create` ever set the slug, so renaming a collection left the old
     * one in place — which is how "Office wear" ended up living at
     * /collections/street-ready and "Summer Collection" at /collections/
     * office-chic. Every seeded collection had been renamed, so every URL on
     * the collections page pointed at a name nobody recognised.
     *
     * An explicit slug in the payload still wins, so an admin can pin a URL
     * they have already shared.
     */
    if (data.name && !data.slug) {
      const base = createSlug(data.name);
      if (base && base !== existing.slug) {
        // slug is unique; a rename must not 500 because another collection got
        // there first.
        const clash = await prisma.collection.findFirst({
          where: { slug: base, NOT: { id } },
          select: { id: true },
        });
        data.slug = clash ? `${base}-${Date.now().toString(36)}` : base;
      }
    }

    if (image) data.image = getImageUrl(image.path);
    if (bannerImage) data.bannerImage = getImageUrl(bannerImage.path);
    if (data.isActive !== undefined) data.isActive = data.isActive === 'true' || data.isActive === true;
    if (data.isFeatured !== undefined) data.isFeatured = data.isFeatured === 'true' || data.isFeatured === true;
    if (data.sortOrder !== undefined) data.sortOrder = parseInt(data.sortOrder, 10);

    // An empty string from the form means "clear this", which is how a banner
    // is removed without deleting the collection.
    if (data.bannerImage === '') data.bannerImage = null;

    const collection = await prisma.collection.update({ where: { id }, data });

    // Only once the row points elsewhere, so a crash between the two cannot
    // leave the collection referencing a file that no longer exists.
    if (image && existing.image && existing.image !== collection.image) {
      await deleteUploadByUrl(existing.image);
    }
    if (existing.bannerImage && existing.bannerImage !== collection.bannerImage) {
      await deleteUploadByUrl(existing.bannerImage);
    }

    return sendSuccess(res, collection, 'Collection updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    await prisma.collection.delete({ where: { id } });
    return sendSuccess(res, null, 'Collection deleted');
  }

  async getProducts(req: Request, res: Response) {
    const { id } = req.params;
    const { page, limit, search } = req.query as Record<string, string>;
    const { page: p, limit: l, skip } = paginationParams(page || '1', limit || '20');

    const where: any = { collections: { some: { collectionId: id } }, deletedAt: null };
    if (search) where.name = { contains: search };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: l,
        // A collection spans categories, so admin priority does not apply here.
        // This had no ordering at all, which meant paginating could show the
        // same product twice and skip another.
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true, name: true, slug: true, basePrice: true, salePrice: true, isActive: true,
          images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          category: { select: { name: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);
    return sendPaginated(res, products, total, p, l, 'Products fetched');
  }

  async addProduct(req: Request, res: Response) {
    const { id } = req.params;
    const { productId } = req.body;
    if (!productId) return sendError(res, 'productId required', 400);

    const col = await prisma.collection.findUnique({ where: { id } });
    if (!col) return sendError(res, 'Collection not found', 404);

    const existing = await prisma.productCollection.findUnique({
      where: { productId_collectionId: { productId, collectionId: id } },
    });
    if (existing) return sendSuccess(res, existing, 'Already in collection');

    const result = await prisma.productCollection.create({ data: { productId, collectionId: id } });
    return sendSuccess(res, result, 'Product added', 201);
  }

  async removeProduct(req: Request, res: Response) {
    const { id, productId } = req.params;
    await prisma.productCollection.delete({
      where: { productId_collectionId: { productId, collectionId: id } },
    });
    return sendSuccess(res, null, 'Product removed');
  }
}

export const collectionController = new CollectionController();
