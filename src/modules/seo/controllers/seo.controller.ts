import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { paginationParams } from '../../../utils/slugify';
import { resolveCmsPage } from '../../../utils/countryContent';
import { resolveCountryIdForBrowsing } from '../../../utils/countryPricing';

export class SeoController {
  async getByPage(req: Request, res: Response) {
    const { page } = req.params;
    const seo = await prisma.seoMeta.findUnique({ where: { page } });
    return sendSuccess(res, seo, 'SEO meta fetched');
  }

  async upsert(req: Request, res: Response) {
    const { page, ...data } = req.body;
    const seo = await prisma.seoMeta.upsert({
      where: { page },
      create: { page, ...data },
      update: data,
    });
    return sendSuccess(res, seo, 'SEO meta saved');
  }

  async getAll(req: Request, res: Response) {
    const { page, limit, search } = req.query as Record<string, string>;

    if (page === undefined) {
      const pages = await prisma.seoMeta.findMany({ orderBy: { page: 'asc' } });
      return sendSuccess(res, pages, 'SEO pages fetched');
    }

    const where: any = {};
    if (search) where.page = { contains: search };

    const { page: p, limit: l, skip } = paginationParams(page, limit);
    const [data, total] = await Promise.all([
      prisma.seoMeta.findMany({ where, orderBy: { page: 'asc' }, skip, take: l }),
      prisma.seoMeta.count({ where }),
    ]);
    return sendPaginated(res, data, total, p, l, 'SEO pages fetched');
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const seo = await prisma.seoMeta.update({ where: { id }, data: req.body });
    return sendSuccess(res, seo, 'SEO meta updated');
  }

  async getCmsPage(req: Request, res: Response) {
    const { slug } = req.params;
    const { country } = req.query as Record<string, string>;
    const countryId = await resolveCountryIdForBrowsing(country);
    const page = await resolveCmsPage(prisma, slug, countryId);
    if (!page || !page.isActive) return sendError(res, 'Page not found', 404);
    return sendSuccess(res, page, 'CMS page fetched');
  }

  async getAllCmsPages(req: Request, res: Response) {
    const pages = await prisma.cmsPage.findMany({ orderBy: { sortOrder: 'asc' } });
    return sendSuccess(res, pages, 'CMS pages fetched');
  }

  /**
   * `slug` alone is no longer unique (see the CmsPage model comment) — a
   * page is now identified by (slug, countryId), null countryId meaning the
   * global page. `countryId` in the body selects which one this write
   * targets; omitted/null upserts the global page, matching the old
   * single-page-per-slug behaviour for anyone not passing it.
   *
   * Split into two paths rather than one Prisma `upsert`: a real countryId
   * makes (slug, countryId) a genuine unique constraint Prisma can target
   * atomically, but a null countryId can't — see the schema comment and
   * `resolveCmsPage()` for why. The null-countryId path does a manual
   * find-then-write instead; it isn't atomic, but only an admin uses this
   * endpoint, so the race window is not a real concern.
   */
  async upsertCmsPage(req: Request, res: Response) {
    const { slug, countryId, ...data } = req.body;
    const resolvedCountryId = countryId || null;

    if (resolvedCountryId) {
      const page = await prisma.cmsPage.upsert({
        where: { slug_countryId: { slug, countryId: resolvedCountryId } },
        create: { slug, countryId: resolvedCountryId, ...data },
        update: data,
      });
      return sendSuccess(res, page, 'CMS page saved');
    }

    const existing = await prisma.cmsPage.findFirst({ where: { slug, countryId: null } });
    const page = existing
      ? await prisma.cmsPage.update({ where: { id: existing.id }, data })
      : await prisma.cmsPage.create({ data: { slug, countryId: null, ...data } });
    return sendSuccess(res, page, 'CMS page saved');
  }
}

export const seoController = new SeoController();
