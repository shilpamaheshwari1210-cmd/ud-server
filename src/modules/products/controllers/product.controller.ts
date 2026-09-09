import { Request, Response } from 'express';
import { productService } from '../services/product.service';
import { sendSuccess, sendPaginated, sendError } from '../../../utils/response';
import { getImageUrl } from '../../../utils/upload';
import { colorNameToHex } from '../../../utils/colorName';
import { prisma } from '../../../config/prisma';
import { buildProductWorkbook } from '../services/productExport.service';

const parseArray = (val: any): string[] | undefined => {
  if (!val) return undefined;
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : undefined; } catch {}
  if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
  return undefined;
};

/**
 * A plain string map from multipart, e.g. the image-to-colour assignment.
 * Anything that is not an object of strings collapses to {} — a malformed
 * field should leave the images untagged, never abort the whole save.
 */
const parseObject = (val: any): Record<string, string | null> => {
  if (!val) return {};
  const raw = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  return out;
};

const parseBool = (val: any): boolean | undefined => {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === '1';
};

const parseNum = (val: any): number | undefined => {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
};

const sanitizeProductBody = (body: any) => {
  const b = { ...body };
  // Booleans
  for (const k of ['isFeatured','isTrending','isNewArrival','isBestSeller','isActive','trackInventory']) {
    if (k in b) b[k] = parseBool(b[k]);
  }
  // Numbers
  for (const k of ['basePrice','salePrice','stockQuantity','sortOrder','taxPercent','costPrice','weight','lowStockAlert','standardShippingCharge','codShippingCharge','expressShippingCharge']) {
    if (k in b) b[k] = parseNum(b[k]);
  }
  // Arrays
  b.tags = parseArray(b.tags);
  b.collectionIds = parseArray(b.collectionIds);
  // Field name mapping: frontend → Prisma schema
  if (b.material !== undefined) { b.fabric = b.fabric || b.material; delete b.material; }
  if (b.metaDescription !== undefined) { b.metaDesc = b.metaDesc || b.metaDescription; delete b.metaDescription; }
  // Remove fields not in Prisma schema
  delete b.fit;
  delete b.style;
  // Consumed by the controller before this point (create) or re-attached
  // straight after it (update). Leaving it here would reach `product.create`
  // as an unknown column and fail the whole save.
  delete b.imageColors;
  // Normalize gender value
  if (b.gender) b.gender = String(b.gender).toUpperCase();
  // Parse variants JSON string → flat variantsData array
  if (b.variants && !b.variantsData) {
    try {
      const parsed = typeof b.variants === 'string' ? JSON.parse(b.variants) : b.variants;
      if (Array.isArray(parsed)) {
        b.variantsData = parsed.flatMap((v: any) =>
          (v.sizes || []).map((s: any) => ({
            color: v.color || undefined,
            // Admins type a colour name; derive the swatch here so the bulk
            // create path matches the single-variant path.
            colorHex: v.colorHex || colorNameToHex(v.color) || undefined,
            size: s.size || undefined,
            stockQuantity: s.stock ? Number(s.stock) : 0,
            price: s.price ? Number(s.price) : undefined,
          }))
        );
      }
    } catch {}
    delete b.variants;
  }
  return b;
};

/**
 * Guarantee a sensible product-level stock figure on create.
 *
 * Order validation checks `Product.stockQuantity` — NOT the sum of variant
 * stock (see OrderService.createOrder). A create request that omits the field
 * therefore lands on the Prisma default of 0 and the product is unbuyable
 * ("Insufficient stock") no matter how much variant stock was entered
 * alongside it. That is exactly what happened to every product added through
 * the admin form, which had no stock input at all.
 *
 * When the caller does not state a figure, fall back to the total across the
 * variants it did supply. An explicit 0 is still honoured — that is a
 * deliberate "out of stock".
 */
const withDerivedStock = (b: any) => {
  const provided = b.stockQuantity;
  const isMissing =
    provided === undefined || provided === null || provided === '' || Number.isNaN(provided);

  if (!isMissing) return b;

  const total = Array.isArray(b.variantsData)
    ? b.variantsData.reduce((sum: number, v: any) => sum + (Number(v.stockQuantity) || 0), 0)
    : 0;

  return { ...b, stockQuantity: total };
};

export class ProductController {
  /**
   * Admin catalogue listing — includes drafts, which the public listing hides.
   */
  async getAdminProducts(req: Request, res: Response) {
    const { page, limit, search, categoryId, gender, sortBy, status } =
      req.query as Record<string, string>;

    const result = await productService.getAdminProducts({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search,
      categoryId,
      gender,
      sortBy: sortBy as any,
      status: status === 'active' || status === 'draft' ? status : undefined,
    });

    return sendPaginated(res, result.products, result.total, result.page, result.limit);
  }

  /**
   * The filtered catalogue as an .xlsx download.
   *
   * Takes the same query parameters as the admin listing, so whatever is on
   * screen is what lands in the file — the caller passes its current filters
   * through unchanged rather than the export inventing its own.
   */
  async exportAdminProducts(req: Request, res: Response) {
    const { search, categoryId, gender, status } = req.query as Record<string, string>;

    const filters = {
      search,
      categoryId,
      gender,
      status: status === 'active' || status === 'draft' ? (status as 'active' | 'draft') : undefined,
    };

    const products = await productService.getAdminProductsForExport(filters);

    // Named on the server so the filename records the filters and the date —
    // a folder of files called "products.xlsx" is unusable a week later.
    const parts = ['products'];
    if (filters.status) parts.push(filters.status);
    if (filters.gender) parts.push(filters.gender.toLowerCase());
    if (filters.search) parts.push(filters.search.replace(/[^a-z0-9]+/gi, '-').slice(0, 24).toLowerCase());
    parts.push(new Date().toISOString().slice(0, 10));
    const filename = `${parts.filter(Boolean).join('-')}.xlsx`;

    let categoryName: string | undefined;
    if (categoryId) {
      const c = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
      categoryName = c?.name;
    }

    const buffer = await buildProductWorkbook(products, {
      total: products.length,
      filters: { search, status, gender, categoryId, categoryName },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // The browser needs to read the filename off a cross-origin response.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Length', String(buffer.length));
    return res.send(buffer);
  }

  async getProducts(req: Request, res: Response) {
    const {
      page, limit, search, categoryId, categorySlug, collectionSlug, collectionId,
      minPrice, maxPrice, sizes, colors, brands, isFeatured, isTrending,
      isNewArrival, isBestSeller, inStock, rating, sortBy, gender,
    } = req.query as Record<string, string>;

    const parseBool = (v: string | undefined) =>
      v === 'true' ? true : v === 'false' ? false : undefined;

    const result = await productService.getProducts({
      page: Number(page), limit: Number(limit), search, categoryId, categorySlug, collectionSlug, collectionId,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      sizes: sizes?.split(','),
      colors: colors?.split(','),
      brands: brands?.split(','),
      isFeatured:   parseBool(isFeatured),
      isTrending:   parseBool(isTrending),
      isNewArrival: parseBool(isNewArrival),
      isBestSeller: parseBool(isBestSeller),
      inStock:      inStock === 'true' ? true : undefined,
      rating: rating ? Number(rating) : undefined,
      sortBy: sortBy as any,
      gender: gender || undefined,
    });

    return sendPaginated(res, result.products, result.total, result.page, result.limit);
  }

  async getProductBySlug(req: Request, res: Response) {
    const { slug } = req.params;
    const product = await productService.getProductBySlug(slug);
    return sendSuccess(res, product, 'Product fetched');
  }

  async createProduct(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[] | undefined;
    // Which colour each upload is a shot of, keyed by `new:<n>` — the same
    // token vocabulary the reorder UI already uses.
    const imageColors = parseObject(req.body.imageColors);
    const images = files?.map((file, index) => ({
      url: getImageUrl(file.path),
      altText: req.body.name,
      isPrimary: index === 0,
      sortOrder: index,
      color: imageColors[`new:${index}`] || null,
    }));

    const body = withDerivedStock(sanitizeProductBody({ ...req.body, images }));
    const product = await productService.createProduct(body);
    return sendSuccess(res, product, 'Product created', 201);
  }

  async getProductById(req: Request, res: Response) {
    const { id } = req.params;
    const product = await productService.getProductById(id);
    return sendSuccess(res, product, 'Product fetched');
  }

  async updateProduct(req: Request, res: Response) {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[] | undefined;
    // Position and cover are assigned by the service from imageOrder, so the
    // upload itself no longer guesses at either.
    const imageColors = parseObject(req.body.imageColors);
    const newImages = files?.map((file, index) => ({
      url: getImageUrl(file.path),
      altText: req.body.name || '',
      color: imageColors[`new:${index}`] || null,
    }));

    const removeImageIds = req.body.removeImageIds
      ? (typeof req.body.removeImageIds === 'string' ? JSON.parse(req.body.removeImageIds) : req.body.removeImageIds)
      : [];

    // Ordered token list from the admin drag UI: existing image ids, plus
    // `new:<n>` for the nth file in this same upload.
    const imageOrder = parseArray(req.body.imageOrder);

    const body = sanitizeProductBody({ ...req.body, newImages, removeImageIds, imageOrder });
    // After the sanitizer, which strips it as a non-column field.
    body.imageColors = imageColors;
    const product = await productService.updateProduct(id, body);
    return sendSuccess(res, product, 'Product updated');
  }

  async deleteProduct(req: Request, res: Response) {
    const { id } = req.params;
    await productService.deleteProduct(id);
    return sendSuccess(res, null, 'Product deleted');
  }

  async getFeaturedProducts(req: Request, res: Response) {
    const { gender } = req.query as Record<string, string>;
    const products = await productService.getFeaturedProducts(Number(req.query.limit) || 8, gender);
    return sendSuccess(res, products, 'Featured products');
  }

  async getTrendingProducts(req: Request, res: Response) {
    const { gender } = req.query as Record<string, string>;
    const products = await productService.getTrendingProducts(Number(req.query.limit) || 8, gender);
    return sendSuccess(res, products, 'Trending products');
  }

  async getNewArrivals(req: Request, res: Response) {
    const { gender } = req.query as Record<string, string>;
    const products = await productService.getNewArrivals(Number(req.query.limit) || 8, gender);
    return sendSuccess(res, products, 'New arrivals');
  }

  async getBestSellers(req: Request, res: Response) {
    const { gender } = req.query as Record<string, string>;
    const products = await productService.getBestSellers(Number(req.query.limit) || 8, gender);
    return sendSuccess(res, products, 'Best sellers');
  }

  async search(req: Request, res: Response) {
    const { q, limit } = req.query as Record<string, string>;
    if (!q) return sendError(res, 'Search query required', 400);
    const products = await productService.searchProducts(q, Number(limit) || 10);
    return sendSuccess(res, products, 'Search results');
  }

  /**
   * PATCH /products/positions — bulk display-priority update.
   * Body: { items: [{ id, sortOrder }] }. Higher sortOrder shows first.
   */
  async updatePositions(req: Request, res: Response) {
    const { items } = req.body;
    if (!Array.isArray(items)) return sendError(res, 'items array required', 400);
    const updated = await productService.updatePositions(items);
    return sendSuccess(res, { updated }, 'Positions updated');
  }

  // ── Variant CRUD ──────────────────────────────────────────────

  async getVariants(req: Request, res: Response) {
    const { id } = req.params;
    const variants = await productService.getVariants(id);
    return sendSuccess(res, variants, 'Variants fetched');
  }

  async createVariant(req: Request, res: Response) {
    const { id } = req.params;
    const variant = await productService.createVariant(id, req.body);
    return sendSuccess(res, variant, 'Variant created', 201);
  }

  async updateVariant(req: Request, res: Response) {
    const { id, vid } = req.params;
    const variant = await productService.updateVariant(id, vid, req.body);
    return sendSuccess(res, variant, 'Variant updated');
  }

  async deleteVariant(req: Request, res: Response) {
    const { id, vid } = req.params;
    await productService.deleteVariant(id, vid);
    return sendSuccess(res, null, 'Variant deleted');
  }
}

export const productController = new ProductController();
