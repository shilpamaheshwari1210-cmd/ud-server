import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { deleteUploadByUrl } from '../../../utils/upload';
import { AppError } from '../../../middlewares/error.middleware';
import { createSlug } from '../../../utils/slugify';
import { colorNameToHex } from '../../../utils/colorName';
import { paginationParams } from '../../../utils/slugify';
import { applyCountryOverrides, resolveCountryIdForBrowsing } from '../../../utils/countryPricing';

export interface ProductFilters {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  collectionSlug?: string;
  collectionId?: string;
  /** Phase 2 handicraft domain — see phase-2-handicraft-domain-spec.md */
  materialSlug?: string;
  styleSlug?: string;
  roomSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  sizes?: string[];
  colors?: string[];
  brands?: string[];
  isFeatured?: boolean;
  isTrending?: boolean;
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  inStock?: boolean;
  rating?: number;
  gender?: string;
  sortBy?: 'price_asc' | 'price_desc' | 'newest' | 'popular' | 'rating' | 'name';
  /**
   * ISO 3166-1 alpha-2 country code from `?country=`. Resolved to a
   * ProductCountryPricing/ProductCountryAvailability override per product —
   * see country-architecture-spec.md. Unknown/unrecognised codes are ignored
   * (public browsing must not 400 on a bad query param) rather than thrown,
   * unlike the order-placement path, which is server-authoritative and does
   * throw on an unknown country.
   */
  country?: string;
}

/**
 * Curated display order *within a category*.
 *
 * `Product.sortOrder` is a display PRIORITY: higher shows first, 0 the neutral
 * default. It is deliberately scoped to category-filtered listings rather than
 * applied globally — a single number cannot express "first in Denim" and
 * "seventh in Summer" at once, so applied catalogue-wide it just pins one
 * product to the top of every screen, which is not a merchandising decision
 * anyone wants to make.
 *
 * Descending is what makes the default safe: with ascending, every untouched
 * product would sit at 0 and outrank anything deliberately promoted.
 *
 * Callers pass the ordering that applies among products of equal priority, and
 * `createdAt` closes it out so the result is never left to the database.
 */
const byPriority = (
  ...tiebreakers: Prisma.ProductOrderByWithRelationInput[]
): Prisma.ProductOrderByWithRelationInput[] => [
  { sortOrder: 'desc' },
  ...tiebreakers,
  { createdAt: 'desc' },
];

/**
 * Deterministic order for every listing that is NOT scoped to a category.
 *
 * Ordering by a column every row shares leaves the tie to the database, which
 * is how newly added products ended up wherever the storage engine put them.
 */
const stableOrder = (
  ...primary: Prisma.ProductOrderByWithRelationInput[]
): Prisma.ProductOrderByWithRelationInput[] => [...primary, { createdAt: 'desc' }];


export class ProductService {
  async getProducts(filters: ProductFilters) {
    const { page, limit, skip } = paginationParams(filters.page, filters.limit);

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      deletedAt: null,
    };

    // Collect AND conditions so that search text and price range don't overwrite each other
    const andConditions: Prisma.ProductWhereInput[] = [];

    if (filters.search) {
      andConditions.push({
        OR: [
          { name: { contains: filters.search } },
          { description: { contains: filters.search } },
          { brand: { contains: filters.search } },
          { sku: { contains: filters.search } },
        ],
      });
    }

    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.categorySlug) where.category = { slug: filters.categorySlug };
    if (filters.collectionSlug) where.collections = { some: { collection: { slug: filters.collectionSlug } } };
    // By id as well as by slug. The collection page holds the record it just
    // fetched, so it filters by id — which it was already sending, and which
    // was being dropped silently, leaving every collection showing the entire
    // catalogue. An id also survives a rename, where a slug does not.
    if (filters.collectionId) where.collections = { some: { collectionId: filters.collectionId } };
    if (filters.materialSlug) where.material = { slug: filters.materialSlug };
    if (filters.styleSlug) where.style = { slug: filters.styleSlug };
    if (filters.roomSlug) where.room = { slug: filters.roomSlug };
    if (filters.isFeatured !== undefined) where.isFeatured = filters.isFeatured;
    if (filters.isTrending !== undefined) where.isTrending = filters.isTrending;
    if (filters.isNewArrival !== undefined) where.isNewArrival = filters.isNewArrival;
    if (filters.isBestSeller !== undefined) where.isBestSeller = filters.isBestSeller;
    if (filters.gender && filters.gender !== 'ALL') {
      (where as any).gender = { in: [filters.gender.toUpperCase(), 'UNISEX'] };
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      andConditions.push({
        OR: [
          { salePrice: { gte: filters.minPrice, lte: filters.maxPrice } },
          {
            AND: [
              { salePrice: null },
              { basePrice: { gte: filters.minPrice, lte: filters.maxPrice } },
            ],
          },
        ],
      });
    }

    if (andConditions.length > 0) where.AND = andConditions;

    if (filters.brands?.length) where.brand = { in: filters.brands };
    if (filters.inStock) where.stockQuantity = { gt: 0 };
    if (filters.rating) where.avgRating = { gte: filters.rating };

    // Merge size and color into a single variant filter so they don't overwrite each other
    if (filters.sizes?.length || filters.colors?.length) {
      const variantFilter: Prisma.ProductVariantWhereInput = { isActive: true };
      if (filters.sizes?.length) variantFilter.size = { in: filters.sizes };
      if (filters.colors?.length) variantFilter.color = { in: filters.colors };
      where.variants = { some: variantFilter };
    }

    // Admin-set priority applies only inside a category. Browsing the whole
    // catalogue, or searching, falls back to newest — a per-product number has
    // no meaning across unrelated categories.
    const inCategory = Boolean(filters.categoryId || filters.categorySlug);

    // An explicit shopper sort stays pure — priority must not quietly override
    // "Price: Low to High" or the sort looks broken.
    let orderBy: Prisma.ProductOrderByWithRelationInput[];
    switch (filters.sortBy) {
      case 'price_asc':  orderBy = stableOrder({ basePrice: 'asc' }); break;
      case 'price_desc': orderBy = stableOrder({ basePrice: 'desc' }); break;
      case 'newest':     orderBy = [{ createdAt: 'desc' }]; break;
      case 'popular':    orderBy = stableOrder({ totalSold: 'desc' }); break;
      case 'rating':     orderBy = stableOrder({ avgRating: 'desc' }); break;
      case 'name':       orderBy = [{ name: 'asc' }]; break;
      default:           orderBy = inCategory ? byPriority() : [{ createdAt: 'desc' }];
    }

    const [total, rawProducts] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
          category: { select: { id: true, name: true, slug: true } },
          material: { select: { id: true, name: true, slug: true } },
          style: { select: { id: true, name: true, slug: true } },
          room: { select: { id: true, name: true, slug: true } },
          artisan: { select: { id: true, name: true, region: true } },
          variants: { where: { isActive: true }, select: { size: true, color: true, colorHex: true, stockQuantity: true } },
          badges: true,
        },
      }),
    ]);

    const countryId = await resolveCountryIdForBrowsing(filters.country);
    const products = await applyCountryOverrides(rawProducts, countryId);

    return { products, total, page, limit };
  }

  /**
   * Admin catalogue listing — every product regardless of isActive.
   *
   * The storefront listing hard-filters `isActive: true`, which is correct for
   * shoppers but made the admin screen unusable: the admin page was calling the
   * same public endpoint, so a deactivated product vanished from the catalogue
   * entirely and could never be found again to re-publish it. Imported drafts
   * were invisible for the same reason.
   *
   * Soft-deleted products stay excluded — those are deleted, not hidden.
   */
  /**
   * The admin catalogue filter, in one place.
   *
   * Extracted so the export cannot drift from the listing. A spreadsheet that
   * quietly disagrees with the screen it was downloaded from is worse than no
   * spreadsheet: the numbers look authoritative and are wrong.
   */
  private adminProductWhere(
    filters: ProductFilters & { status?: 'active' | 'draft' },
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { deletedAt: null };
    const and: Prisma.ProductWhereInput[] = [];

    if (filters.status === 'active') where.isActive = true;
    if (filters.status === 'draft') where.isActive = false;

    if (filters.search) {
      and.push({
        OR: [
          { name: { contains: filters.search } },
          { sku: { contains: filters.search } },
          { brand: { contains: filters.search } },
        ],
      });
    }
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.gender && filters.gender !== 'ALL') {
      (where as any).gender = filters.gender.toUpperCase();
    }
    if (and.length) where.AND = and;
    return where;
  }

  async getAdminProducts(filters: ProductFilters & { status?: 'active' | 'draft' }) {
    const { page, limit, skip } = paginationParams(filters.page, filters.limit);
    const where = this.adminProductWhere(filters);

    // Mirrors the storefront: filtering to a category shows that category's
    // curated order, so the admin arranging priorities sees exactly what a
    // shopper browsing that category will see. Unfiltered, it is newest first.
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      filters.sortBy === 'name' ? [{ name: 'asc' }] :
      filters.sortBy === 'price_asc' ? [{ basePrice: 'asc' }] :
      filters.sortBy === 'price_desc' ? [{ basePrice: 'desc' }] :
      filters.sortBy === 'newest' ? [{ createdAt: 'desc' }] :
      filters.categoryId ? byPriority() : [{ createdAt: 'desc' }];

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
          category: { select: { id: true, name: true, slug: true } },
          material: { select: { id: true, name: true, slug: true } },
          style: { select: { id: true, name: true, slug: true } },
          room: { select: { id: true, name: true, slug: true } },
          artisan: { select: { id: true, name: true, region: true } },
          _count: { select: { variants: true } },
        },
      }),
    ]);

    return { products, total, page, limit };
  }

  /**
   * Every product matching the current admin filters, for the spreadsheet.
   *
   * Unpaginated on purpose — the point of an export is the whole filtered set,
   * not the page that happens to be on screen — but capped, because an
   * unbounded query on a growing catalogue is how an export takes a server
   * down. All images are included; the sheet decides how to present them.
   */
  async getAdminProductsForExport(
    filters: ProductFilters & { status?: 'active' | 'draft' },
    max = 5000,
  ) {
    const where = this.adminProductWhere(filters);

    return prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: max,
      include: {
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { url: true, isPrimary: true, color: true } },
        category: { select: { name: true } },
        variants: { select: { size: true, color: true, stockQuantity: true, sku: true, isActive: true } },
        tags: { select: { tag: true } },
      },
    });
  }

  async getProductBySlug(slug: string, country?: string) {
    const product = await prisma.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        category: { select: { id: true, name: true, slug: true } },
        material: true,
        style: true,
        room: true,
        artisan: true,
        variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        tags: true,
        badges: true,
        faqs: { orderBy: { sortOrder: 'asc' } },
        collections: { include: { collection: { select: { id: true, name: true, slug: true } } } },
        reviews: {
          where: { isApproved: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
        },
        relatedProducts: {
          include: {
            relatedProduct: {
              include: { images: { where: { isPrimary: true }, take: 1 } },
            },
          },
          take: 8,
        },
      },
    });

    if (!product) throw new AppError('Product not found', 404);

    await prisma.product.update({
      where: { id: product.id },
      data: { viewCount: { increment: 1 } },
    });

    /**
     * Fill "You May Also Like" when nobody has curated it.
     *
     * The section only ever read the hand-picked `relatedProducts` join, and
     * no product in the catalogue has any, so the bottom of every product page
     * was a dead end — the one place a shopper is most likely to keep
     * browsing. A curated list still wins where it exists; this only covers
     * the gap.
     *
     * Same category, best sellers first, then the category's own curated
     * priority — so this row agrees with the ordering the admin already
     * controls rather than inventing a second opinion.
     */
    let suggested: any[] = [];
    if (!product.relatedProducts?.length && product.categoryId) {
      suggested = await prisma.product.findMany({
        where: {
          categoryId: product.categoryId,
          id: { not: product.id },
          isActive: true,
          deletedAt: null,
        },
        orderBy: [{ totalSold: 'desc' }, { sortOrder: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        include: {
          images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1 },
          variants: { where: { isActive: true }, select: { color: true, size: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
      });
    }

    const countryId = await resolveCountryIdForBrowsing(country);
    const [priced] = await applyCountryOverrides([product], countryId);

    return { ...priced, suggestedProducts: suggested };
  }

  async createProduct(data: Prisma.ProductCreateInput & {
    images?: { url: string; altText?: string; isPrimary?: boolean; sortOrder?: number; color?: string | null }[];
    variantsData?: { size?: string; color?: string; colorHex?: string; sku?: string; price?: number; salePrice?: number; stockQuantity?: number }[];
    tags?: string[];
    collectionIds?: string[];
  }) {
    const { images, variantsData, tags, collectionIds, ...productData } = data as any;

    if (!productData.slug) {
      productData.slug = createSlug(productData.name);
    }

    const existing = await prisma.product.findUnique({ where: { slug: productData.slug } });
    if (existing) productData.slug = `${productData.slug}-${Date.now()}`;

    const product = await prisma.product.create({
      data: {
        ...productData,
        images: images?.length ? { create: images } : undefined,
        variants: variantsData?.length ? { create: variantsData } : undefined,
        tags: tags?.length ? { create: tags.map((tag: string) => ({ tag })) } : undefined,
        collections: collectionIds?.length ? {
          create: collectionIds.map((collectionId: string) => ({ collectionId })),
        } : undefined,
      },
      include: {
        images: true, variants: true, tags: true,
        material: true, style: true, room: true, artisan: true,
      },
    });

    return product;
  }

  async getProductById(id: string) {
    const product = await prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        category: { select: { id: true, name: true, slug: true } },
        material: true,
        style: true,
        room: true,
        artisan: true,
        variants: { orderBy: [{ color: 'asc' }, { sortOrder: 'asc' }] },
        tags: true,
        badges: true,
        faqs: { orderBy: { sortOrder: 'asc' } },
        collections: { include: { collection: { select: { id: true, name: true, slug: true } } } },
      },
    });
    if (!product) throw new AppError('Product not found', 404);
    return product;
  }

  async getVariants(productId: string) {
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new AppError('Product not found', 404);
    return prisma.productVariant.findMany({
      where: { productId },
      orderBy: [{ color: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createVariant(productId: string, data: any) {
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new AppError('Product not found', 404);

    return prisma.productVariant.create({
      data: {
        productId,
        color: data.color || '',
        // The admin types a colour NAME now; the swatch is derived from it so
        // storefront rendering is unchanged. An explicit hex still wins.
        colorHex: data.colorHex || colorNameToHex(data.color) || '#CCCCCC',
        size: data.size || '',
        sku: data.sku || null,
        price: data.price !== undefined && data.price !== '' ? Number(data.price) : null,
        salePrice: data.salePrice !== undefined && data.salePrice !== '' ? Number(data.salePrice) : null,
        stockQuantity: data.stockQuantity !== undefined ? Number(data.stockQuantity) : 0,
        isActive: data.isActive === true || data.isActive === 'true',
        sortOrder: data.sortOrder ? Number(data.sortOrder) : 0,
      },
    });
  }

  async updateVariant(productId: string, variantId: string, data: any) {
    const variant = await prisma.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!variant) throw new AppError('Variant not found', 404);

    const updates: any = {};
    if (data.color !== undefined) {
      updates.color = data.color;
      // Renaming the colour should move the swatch with it, unless a hex was
      // sent explicitly in the same request.
      if (data.colorHex === undefined) {
        updates.colorHex = colorNameToHex(data.color) || '#CCCCCC';
      }
    }
    if (data.colorHex !== undefined) updates.colorHex = data.colorHex;
    if (data.size !== undefined) updates.size = data.size;
    if (data.sku !== undefined) updates.sku = data.sku;
    if (data.price !== undefined) updates.price = data.price !== '' ? Number(data.price) : null;
    if (data.salePrice !== undefined) updates.salePrice = data.salePrice !== '' ? Number(data.salePrice) : null;
    if (data.stockQuantity !== undefined) updates.stockQuantity = Number(data.stockQuantity);
    if (data.isActive !== undefined) updates.isActive = data.isActive === true || data.isActive === 'true';
    if (data.sortOrder !== undefined) updates.sortOrder = Number(data.sortOrder);

    return prisma.productVariant.update({ where: { id: variantId }, data: updates });
  }

  /**
   * Bulk-set display priorities.
   *
   * Separate from updateProduct so the admin list can renumber several rows in
   * one request without pushing each product through the full update path
   * (image ordering, tag replacement, slug regeneration).
   */
  async updatePositions(items: { id: string; sortOrder: number }[]) {
    const clean = items
      .filter(i => i && typeof i.id === 'string' && Number.isFinite(Number(i.sortOrder)))
      .map(i => ({ id: i.id, sortOrder: Math.trunc(Number(i.sortOrder)) }));
    if (!clean.length) return 0;

    await prisma.$transaction(
      clean.map(i =>
        prisma.product.updateMany({
          // updateMany, not update: a deleted product must be skipped rather
          // than fail the whole batch.
          where: { id: i.id, deletedAt: null },
          data: { sortOrder: i.sortOrder },
        })
      )
    );
    return clean.length;
  }

  async deleteVariant(productId: string, variantId: string) {
    const variant = await prisma.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!variant) throw new AppError('Variant not found', 404);
    await prisma.productVariant.delete({ where: { id: variantId } });
  }

  async updateProduct(id: string, data: any) {
    const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new AppError('Product not found', 404);

    const { newImages, tags, collectionIds, removeImageIds, imageOrder, imageColors, ...productData } = data;

    // Coerce booleans that come as strings from FormData
    const boolFields = ['isActive', 'isFeatured', 'isTrending', 'isNewArrival', 'isBestSeller', 'trackInventory'];
    for (const f of boolFields) {
      if (productData[f] !== undefined) {
        productData[f] = productData[f] === 'true' || productData[f] === true;
      }
    }
    // Coerce numbers
    const numFields = ['basePrice', 'salePrice', 'stockQuantity', 'sortOrder', 'taxPercent'];
    for (const f of numFields) {
      if (productData[f] !== undefined && productData[f] !== '') {
        productData[f] = Number(productData[f]);
      }
      if (productData[f] === '') delete productData[f];
    }

    if (productData.name && !productData.slug) {
      const newSlug = createSlug(productData.name);
      if (newSlug !== product.slug) productData.slug = newSlug;
    }

    // Remove images by IDs if requested
    if (removeImageIds?.length) {
      // Collect the URLs first: once the rows are gone nothing points at the
      // files any more and they would sit on disk forever.
      const removed = await prisma.productImage.findMany({
        where: { id: { in: removeImageIds }, productId: id },
        select: { url: true },
      });
      await prisma.productImage.deleteMany({ where: { id: { in: removeImageIds }, productId: id } });
      await Promise.all(removed.map(img => deleteUploadByUrl(img.url)));
    }

    // Create the uploads here rather than as a nested `images.create` on the
    // product update: nested creates give no guaranteed id ordering back, and
    // resolving a `new:<n>` token in imageOrder needs index → id to be exact.
    const createdImageIds: string[] = [];
    for (const img of (newImages ?? [])) {
      const created = await prisma.productImage.create({
        data: {
          productId: id,
          url: img.url,
          altText: img.altText || '',
          color: img.color ?? null,
          sortOrder: 0,      // real position assigned by applyImageOrder below
          isPrimary: false,
        },
      });
      createdImageIds.push(created.id);
    }

    // Replace tags if provided
    const parsedTags = tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : null;

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...productData,
        ...(parsedTags !== null && {
          tags: {
            deleteMany: {},
            create: parsedTags.map((tag: string) => ({ tag })),
          },
        }),
      },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        variants: true, tags: true, badges: true,
        material: true, style: true, room: true, artisan: true,
      },
    });

    // Position is the single source of truth; isPrimary is derived from it.
    await this.applyImageOrder(id, imageOrder, createdImageIds);
    await this.applyImageColors(id, imageColors, createdImageIds);
    updated.images = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return updated;
  }

  /**
   * Assign each image to a colour, so the gallery can swap when the customer
   * picks one.
   *
   * `colors` is keyed by the same tokens as `imageOrder` — an existing image
   * id, or `new:<n>` for the nth file in this request — so the admin form
   * speaks one vocabulary for both position and colour.
   *
   * A value of null (or an empty string) clears the tag, which puts the image
   * back in the default set shown when the chosen colour has no shots of its
   * own. That fallback is the whole reason this is nullable: a product with
   * two colours and one photo must still show that photo, not an empty frame.
   *
   * Colours are NOT validated against the product's variants here. An admin
   * routinely uploads the images before adding the variant rows, and rejecting
   * or silently dropping the tag at that moment would lose their work; a tag
   * that matches nothing simply never wins the filter.
   */
  private async applyImageColors(
    productId: string,
    colors?: Record<string, string | null>,
    createdIds: string[] = []
  ) {
    if (!colors || typeof colors !== 'object') return;

    const existing = await prisma.productImage.findMany({
      where: { productId },
      select: { id: true, color: true },
    });
    if (!existing.length) return;
    const current = new Map(existing.map(img => [img.id, img.color]));

    const writes: { id: string; color: string | null }[] = [];
    for (const [token, raw] of Object.entries(colors)) {
      const id = token.startsWith('new:') ? createdIds[Number(token.slice(4))] : token;
      if (!id || !current.has(id)) continue;      // deleted by a concurrent edit
      const next = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      if (current.get(id) === next) continue;     // nothing to write
      writes.push({ id, color: next });
    }
    if (!writes.length) return;

    await prisma.$transaction(
      writes.map(w =>
        prisma.productImage.update({ where: { id: w.id }, data: { color: w.color } })
      )
    );
  }

  /**
   * Renumber a product's images to 0..n-1 and mark position 0 as the cover.
   *
   * `sortOrder` is the single source of truth for gallery order, and
   * `isPrimary` is derived from it, so the grid thumbnail can never disagree
   * with the first image on the detail page.
   *
   * `order` is the ordered token list the admin form sends: either an existing
   * image id, or `new:<n>` for the nth file uploaded in the same request
   * (which is how a just-picked file can be dropped into position 1 without a
   * second save). Tokens that no longer resolve — a concurrent edit deleted
   * the image, say — are skipped, and any image the client did not mention is
   * appended in its current order rather than dropped.
   *
   * With no `order`, this still runs as a normalisation pass: it closes gaps
   * and breaks sortOrder ties deterministically by creation time.
   */
  private async applyImageOrder(productId: string, order?: string[], createdIds: string[] = []) {
    const existing = await prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (!existing.length) return;

    const validIds = new Set(existing.map(img => img.id));
    const ordered: string[] = [];
    const seen = new Set<string>();

    if (Array.isArray(order) && order.length) {
      for (const token of order) {
        const resolved = typeof token === 'string' && token.startsWith('new:')
          ? createdIds[Number(token.slice(4))]
          : token;
        if (!resolved || !validIds.has(resolved) || seen.has(resolved)) continue;
        seen.add(resolved);
        ordered.push(resolved);
      }
    }
    // Anything unmentioned keeps its relative order at the end.
    for (const img of existing) {
      if (!seen.has(img.id)) { seen.add(img.id); ordered.push(img.id); }
    }

    const needsWrite = ordered.some((imgId, idx) => {
      const img = existing.find(e => e.id === imgId)!;
      return img.sortOrder !== idx || img.isPrimary !== (idx === 0);
    });
    if (!needsWrite) return;

    await prisma.$transaction(
      ordered.map((imgId, idx) =>
        prisma.productImage.update({
          where: { id: imgId },
          data: { sortOrder: idx, isPrimary: idx === 0 },
        })
      )
    );
  }

  async deleteProduct(id: string) {
    const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new AppError('Product not found', 404);

    await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async getFeaturedProducts(limit = 8, gender?: string) {
    const gWhere = gender && gender !== 'ALL' ? { gender: { in: [gender.toUpperCase(), 'UNISEX'] } } : {};
    return prisma.product.findMany({
      where: { isActive: true, isFeatured: true, deletedAt: null, ...gWhere } as any,
      take: limit,
      orderBy: stableOrder(),
      include: {
        images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
        variants: { where: { isActive: true }, select: { size: true, color: true, colorHex: true } },
        badges: true,
      },
    });
  }

  async getTrendingProducts(limit = 8, gender?: string) {
    const gWhere = gender && gender !== 'ALL' ? { gender: { in: [gender.toUpperCase(), 'UNISEX'] } } : {};
    return prisma.product.findMany({
      where: { isActive: true, isTrending: true, deletedAt: null, ...gWhere } as any,
      take: limit,
      orderBy: stableOrder({ totalSold: 'desc' }),
      include: {
        images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
        variants: { where: { isActive: true }, select: { size: true, color: true, colorHex: true } },
        badges: true,
      },
    });
  }

  async getNewArrivals(limit = 8, gender?: string) {
    const gWhere = gender && gender !== 'ALL' ? { gender: { in: [gender.toUpperCase(), 'UNISEX'] } } : {};
    return prisma.product.findMany({
      where: { isActive: true, isNewArrival: true, deletedAt: null, ...gWhere } as any,
      take: limit,
      orderBy: stableOrder(),
      include: {
        images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
        variants: { where: { isActive: true }, select: { size: true, color: true, colorHex: true } },
        badges: true,
      },
    });
  }

  async getBestSellers(limit = 8, gender?: string) {
    const gWhere = gender && gender !== 'ALL' ? { gender: { in: [gender.toUpperCase(), 'UNISEX'] } } : {};
    return prisma.product.findMany({
      where: { isActive: true, isBestSeller: true, deletedAt: null, ...gWhere } as any,
      take: limit,
      orderBy: stableOrder({ totalSold: 'desc' }),
      include: {
        images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
        variants: { where: { isActive: true }, select: { size: true, color: true, colorHex: true } },
        badges: true,
      },
    });
  }

  async searchProducts(query: string, limit = 10) {
    return prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { name: { contains: query } },
          { brand: { contains: query } },
          { tags: { some: { tag: { contains: query } } } },
        ],
      },
      take: limit,
      // Search spans every category, so priority does not apply — but it had no
      // ordering at all, which left results in whatever order the database
      // returned them and made the same query look unstable between calls.
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true, name: true, slug: true, basePrice: true, salePrice: true,
        images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1, select: { url: true } },
        category: { select: { name: true, slug: true } },
      },
    });
  }
}

export const productService = new ProductService();
