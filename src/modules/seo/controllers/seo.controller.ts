import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { paginationParams } from '../../../utils/slugify';

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
    const page = await prisma.cmsPage.findFirst({ where: { slug, isActive: true } });
    if (!page) return sendError(res, 'Page not found', 404);
    return sendSuccess(res, page, 'CMS page fetched');
  }

  async getAllCmsPages(req: Request, res: Response) {
    const pages = await prisma.cmsPage.findMany({ orderBy: { sortOrder: 'asc' } });
    return sendSuccess(res, pages, 'CMS pages fetched');
  }

  async upsertCmsPage(req: Request, res: Response) {
    const { slug, ...data } = req.body;
    const page = await prisma.cmsPage.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
    return sendSuccess(res, page, 'CMS page saved');
  }
}

export const seoController = new SeoController();
