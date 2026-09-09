import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/error.middleware';

type Queryable = PrismaClient | Prisma.TransactionClient;

/**
 * Country-aware pricing/availability resolution — see
 * documentation/docs/architecture/country-architecture-spec.md.
 *
 * Pricing rule: a ProductCountryPricing row for (product, country) wins;
 * otherwise fall back to Product.basePrice/salePrice. Not every product needs
 * a row per country — only ones that actually differ.
 *
 * Availability rule: a ProductCountryAvailability row's isAvailable wins;
 * with no row, the product is available (opt-out, not opt-in) — otherwise
 * every existing product would vanish from every country the moment this
 * shipped.
 */

/**
 * Looks up a Country by its ISO code. Throws if a code was given but does not
 * match any row — an unknown country is a real error for anything that spends
 * money (orders); callers browsing the storefront (product list/detail) can
 * catch this and degrade to "no country" rather than breaking on a bad query
 * param.
 */
export async function resolveCountryByCode(
  tx: Queryable,
  code?: string | null,
) {
  const trimmed = (code ?? '').trim();
  if (!trimmed) return null;
  const country = await tx.country.findUnique({ where: { code: trimmed.toUpperCase() } });
  if (!country) throw new AppError(`Unknown country code: ${trimmed}`, 400);
  return country;
}

export async function getCountryPricingMap(
  tx: Queryable,
  countryId: string,
  productIds: string[],
) {
  if (!productIds.length) return new Map<string, { basePrice: Prisma.Decimal; salePrice: Prisma.Decimal | null }>();
  const rows = await tx.productCountryPricing.findMany({
    where: { countryId, productId: { in: productIds } },
  });
  return new Map(rows.map(r => [r.productId, { basePrice: r.basePrice, salePrice: r.salePrice }]));
}

export async function getCountryAvailabilityMap(
  tx: Queryable,
  countryId: string,
  productIds: string[],
) {
  if (!productIds.length) return new Map<string, boolean>();
  const rows = await tx.productCountryAvailability.findMany({
    where: { countryId, productId: { in: productIds } },
  });
  return new Map(rows.map(r => [r.productId, r.isAvailable]));
}

/**
 * Applies the pricing/availability resolution rules to a batch of products
 * already fetched from the DB. `products` must at least carry `id`,
 * `basePrice`, `salePrice`. Mutates nothing — returns new objects.
 */
export async function applyCountryOverrides<
  T extends { id: string; basePrice: any; salePrice: any },
>(products: T[], countryId: string | null | undefined): Promise<(T & { isAvailable: boolean })[]> {
  if (!countryId || !products.length) {
    return products.map(p => ({ ...p, isAvailable: true }));
  }

  const ids = products.map(p => p.id);
  const [pricingMap, availabilityMap] = await Promise.all([
    getCountryPricingMap(prisma, countryId, ids),
    getCountryAvailabilityMap(prisma, countryId, ids),
  ]);

  return products.map(p => {
    const override = pricingMap.get(p.id);
    return {
      ...p,
      basePrice: override ? override.basePrice : p.basePrice,
      salePrice: override ? override.salePrice : p.salePrice,
      isAvailable: availabilityMap.has(p.id) ? availabilityMap.get(p.id)! : true,
    };
  });
}
