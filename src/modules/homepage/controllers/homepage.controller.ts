import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess } from '../../../utils/response';
import { resolveCountryIdForBrowsing } from '../../../utils/countryPricing';
import { resolveHomepageSections, resolveBanners } from '../../../utils/countryContent';

export class HomepageController {
  async getSections(req: Request, res: Response) {
    const { country } = req.query as Record<string, string>;
    const countryId = await resolveCountryIdForBrowsing(country);
    const sections = await resolveHomepageSections(prisma, countryId);
    return sendSuccess(res, sections, 'Homepage sections fetched');
  }

  async getAllSections(req: Request, res: Response) {
    const sections = await prisma.homepageSection.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return sendSuccess(res, sections, 'All sections fetched');
  }

  async updateSection(req: Request, res: Response) {
    const { id } = req.params;
    const section = await prisma.homepageSection.update({
      where: { id },
      data: req.body,
    });
    return sendSuccess(res, section, 'Section updated');
  }

  async createSection(req: Request, res: Response) {
    const section = await prisma.homepageSection.create({ data: req.body });
    return sendSuccess(res, section, 'Section created', 201);
  }

  async deleteSection(req: Request, res: Response) {
    const { id } = req.params;
    await prisma.homepageSection.delete({ where: { id } });
    return sendSuccess(res, null, 'Section deleted');
  }

  async reorderSections(req: Request, res: Response) {
    const { items } = req.body;
    await prisma.$transaction(
      (items as { id: string; sortOrder: number }[]).map(item =>
        prisma.homepageSection.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
      )
    );
    return sendSuccess(res, null, 'Order updated');
  }

  async getFullHomepageData(req: Request, res: Response) {
    // Same gender semantics as GET /banners/:type — a banner targeted at this
    // gender, plus the ones targeted at everyone. Without this the server-
    // rendered homepage showed every banner while the client's own refetch
    // showed the filtered set, so the two disagreed until the first toggle.
    const { gender, country } = req.query as Record<string, string>;
    const gWhere =
      gender && gender.toUpperCase() !== 'ALL'
        ? { gender: { in: [gender.toUpperCase(), 'ALL'] } }
        : {};
    const countryId = await resolveCountryIdForBrowsing(country);

    const [sections, heroBanners, promoBanners, testimonials, settings] = await Promise.all([
      resolveHomepageSections(prisma, countryId),
      resolveBanners(prisma, countryId, { type: 'HERO', ...gWhere }),
      resolveBanners(prisma, countryId, { type: 'PROMOTIONAL', ...gWhere }),
      prisma.testimonial.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.setting.findMany({ where: { group: 'homepage' } }),
    ]);

    return sendSuccess(res, { sections, heroBanners, promoBanners, testimonials, settings }, 'Homepage data fetched');
  }
}

export const homepageController = new HomepageController();
