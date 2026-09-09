import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';

/**
 * Editable navigation links.
 *
 * The quick links at the top of the Shop mega menu — Shop All, New Arrivals,
 * Best Sellers, On Sale — used to be a constant in the storefront bundle, so
 * changing one meant a deploy. They are filters rather than categories, which
 * is why they never lived in the category table.
 *
 * `position` keeps this table general: "quick_links" is the mega-menu row, and
 * a header or footer menu can be added later without a migration. The model
 * itself already existed in the schema and had never been used.
 */

const GENDERS = ['ALL', 'WOMEN', 'MEN'] as const;
type MenuGender = (typeof GENDERS)[number];

/** Unrecognised values fall back to ALL — a typo should never hide a link. */
const normaliseGender = (value: unknown): MenuGender | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const upper = String(value).trim().toUpperCase();
  return (GENDERS as readonly string[]).includes(upper) ? (upper as MenuGender) : 'ALL';
};

/**
 * Links must stay inside this site.
 *
 * These are rendered as ordinary anchors in the site chrome, so an absolute URL
 * pasted here would turn the shop's own menu into an offsite redirect. Only
 * root-relative paths are accepted.
 */
const cleanUrl = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
};

export class NavMenuController {
  /** Public: the links for one position, for the gender being browsed. */
  async getByPosition(req: Request, res: Response) {
    const { position = 'quick_links', gender } = req.query as Record<string, string>;
    const where: any = { position, isActive: true };

    // Asking for ALL (or asking for nothing) means "no preference", which
    // returns every link rather than only the untargeted ones.
    const wanted = normaliseGender(gender);
    if (wanted && wanted !== 'ALL') where.gender = { in: [wanted, 'ALL'] };

    const links = await prisma.navMenu.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, label: true, url: true, gender: true, sortOrder: true },
    });
    return sendSuccess(res, links, 'Nav links fetched');
  }

  /** Admin: everything at a position, active or not. */
  async getAll(req: Request, res: Response) {
    const { position } = req.query as Record<string, string>;
    const links = await prisma.navMenu.findMany({
      where: position ? { position } : {},
      orderBy: [{ position: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return sendSuccess(res, links, 'Nav links fetched');
  }

  async create(req: Request, res: Response) {
    const { label, url, position, gender, sortOrder, isActive } = req.body;
    const cleanLabel = String(label ?? '').trim();
    if (!cleanLabel) return sendError(res, 'A label is required', 400);

    const href = cleanUrl(url);
    if (!href) return sendError(res, 'The link must be a path on this site, starting with /', 400);

    const link = await prisma.navMenu.create({
      data: {
        label: cleanLabel,
        url: href,
        position: String(position || 'quick_links'),
        gender: normaliseGender(gender) ?? 'ALL',
        sortOrder: Number.isFinite(Number(sortOrder)) ? Math.trunc(Number(sortOrder)) : 0,
        isActive: isActive === undefined ? true : Boolean(isActive),
      },
    });
    return sendSuccess(res, link, 'Link created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.navMenu.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Link not found', 404);

    const { label, url, position, gender, sortOrder, isActive } = req.body;
    const data: any = {};

    if (label !== undefined) {
      const cleanLabel = String(label).trim();
      if (!cleanLabel) return sendError(res, 'A label is required', 400);
      data.label = cleanLabel;
    }
    if (url !== undefined) {
      const href = cleanUrl(url);
      if (!href) return sendError(res, 'The link must be a path on this site, starting with /', 400);
      data.url = href;
    }
    if (position !== undefined) data.position = String(position);
    if (gender !== undefined) data.gender = normaliseGender(gender) ?? 'ALL';
    if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) {
      data.sortOrder = Math.trunc(Number(sortOrder));
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const link = await prisma.navMenu.update({ where: { id }, data });
    return sendSuccess(res, link, 'Link updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.navMenu.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Link not found', 404);
    await prisma.navMenu.delete({ where: { id } });
    return sendSuccess(res, null, 'Link deleted');
  }

  /** Bulk positions, so a reorder is one save rather than one per row. */
  async updatePositions(req: Request, res: Response) {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const clean = items
      .filter((i: any) => i && typeof i.id === 'string' && Number.isFinite(Number(i.sortOrder)))
      .map((i: any) => ({ id: i.id, sortOrder: Math.trunc(Number(i.sortOrder)) }));
    if (!clean.length) return sendSuccess(res, { updated: 0 }, 'Nothing to update');

    // updateMany so a row deleted by a concurrent edit is a no-op rather than
    // a failure that rolls back everyone else's positions.
    await prisma.$transaction(
      clean.map((i: { id: string; sortOrder: number }) =>
        prisma.navMenu.updateMany({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })
      )
    );
    return sendSuccess(res, { updated: clean.length }, 'Order updated');
  }

  /**
   * Copy the built-in quick links into the table so they become editable.
   *
   * Until an admin does this the storefront renders the same four links from
   * its own defaults, so the menu is never empty and this is never forced.
   * Idempotent: it refuses once the position already has links, rather than
   * quietly creating a second set.
   */
  async importDefaults(req: Request, res: Response) {
    const position = String(req.body?.position || 'quick_links');
    const existing = await prisma.navMenu.count({ where: { position } });
    if (existing > 0) {
      return sendError(res, 'This menu already has links. Delete them first to re-import.', 400);
    }

    const DEFAULTS = [
      { label: 'Shop All',     url: '/shop' },
      { label: 'New Arrivals', url: '/shop?isNewArrival=true' },
      { label: 'Best Sellers', url: '/shop?sort=best-sellers' },
      { label: 'On Sale',      url: '/shop?discount=true' },
    ];

    await prisma.navMenu.createMany({
      data: DEFAULTS.map((d, index) => ({
        label: d.label,
        url: d.url,
        position,
        gender: 'ALL',
        sortOrder: index * 10,   // gaps, so a link can be slotted between two
        isActive: true,
      })),
    });

    const links = await prisma.navMenu.findMany({
      where: { position },
      orderBy: [{ sortOrder: 'asc' }],
    });
    return sendSuccess(res, links, 'Default links imported', 201);
  }
}

export const navMenuController = new NavMenuController();
export default navMenuController;
