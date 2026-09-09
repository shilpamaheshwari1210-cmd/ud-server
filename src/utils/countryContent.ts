import { Prisma, PrismaClient } from '@prisma/client';

type Queryable = PrismaClient | Prisma.TransactionClient;

/**
 * Global -> Country content inheritance (see
 * documentation/docs/architecture/country-architecture-spec.md, MASTER-PROMPT
 * §30). Rows are scoped by a nullable `countryId`: null = global/default,
 * set = only shown for that country.
 *
 * Two different resolution shapes, because CmsPage is looked up by identity
 * (a slug) while HomepageSection/Banner are unordered lists with no natural
 * per-row identity to match a global row against a country override by:
 *
 *  - CmsPage: single-item lookup. A country-specific row for the slug wins;
 *    with none, fall back to the global row for that slug.
 *  - HomepageSection / Banner: list-level fallback. If the country has ANY
 *    of its own rows (matching the rest of the filter), that whole set
 *    replaces the global set for that country; with none, use the global
 *    set. This is coarser than per-item override, but matches what the
 *    schema actually models — these are unkeyed content lists, not records
 *    with a stable identity a per-item override could attach to.
 */

export async function resolveCmsPage(tx: Queryable, slug: string, countryId: string | null) {
  if (countryId) {
    const scoped = await tx.cmsPage.findUnique({
      where: { slug_countryId: { slug, countryId } },
    });
    if (scoped) return scoped;
  }
  // Prisma's typed compound-key `findUnique` won't accept `null` for
  // countryId — a MySQL composite unique index doesn't treat NULL as a
  // reliably-lookupable value either (see the schema comment). `findFirst`
  // with an explicit `countryId: null` filter is the correct tool here.
  return tx.cmsPage.findFirst({ where: { slug, countryId: null } });
}

export async function resolveHomepageSections(tx: Queryable, countryId: string | null) {
  if (countryId) {
    const scoped = await tx.homepageSection.findMany({
      where: { isActive: true, countryId },
      orderBy: { sortOrder: 'asc' },
    });
    if (scoped.length > 0) return scoped;
  }
  return tx.homepageSection.findMany({
    where: { isActive: true, countryId: null },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function resolveBanners(
  tx: Queryable,
  countryId: string | null,
  extraWhere: Prisma.BannerWhereInput = {},
) {
  if (countryId) {
    const scoped = await tx.banner.findMany({
      where: { isActive: true, countryId, ...extraWhere },
      orderBy: { sortOrder: 'asc' },
    });
    if (scoped.length > 0) return scoped;
  }
  return tx.banner.findMany({
    where: { isActive: true, countryId: null, ...extraWhere },
    orderBy: { sortOrder: 'asc' },
  });
}
