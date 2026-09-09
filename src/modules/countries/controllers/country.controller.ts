import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';

/**
 * Country admin CRUD — see documentation/docs/architecture/country-architecture-spec.md.
 *
 * `isDefault` is enforced as "exactly one row" in code, not a DB constraint
 * (the spec calls this out explicitly): setting a new default here always
 * clears it off every other row in the same write.
 */

const REQUIRED_FIELDS = ['code', 'name', 'currency', 'currencySymbol', 'locale', 'timezone'];

const parseBool = (v: any): boolean | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
};

export class CountryController {
  /** Public: enabled markets only, for a future storefront country selector. */
  async getEnabled(_req: Request, res: Response) {
    const countries = await prisma.country.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return sendSuccess(res, countries, 'Countries fetched');
  }

  /** Admin: every market, enabled or not, for the admin management screen. */
  async getAllAdmin(_req: Request, res: Response) {
    const countries = await prisma.country.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return sendSuccess(res, countries, 'Countries fetched');
  }

  async create(req: Request, res: Response) {
    const body: any = { ...req.body };
    const missing = REQUIRED_FIELDS.filter(f => !String(body[f] ?? '').trim());
    if (missing.length) {
      return sendError(res, `Missing required field(s): ${missing.join(', ')}`, 422);
    }

    const code = String(body.code).trim().toUpperCase();
    const existing = await prisma.country.findUnique({ where: { code } });
    if (existing) return sendError(res, `Country code "${code}" already exists`, 409);

    const isEnabled = parseBool(body.isEnabled) ?? false;
    const isDefault = parseBool(body.isDefault) ?? false;
    const sortOrder = body.sortOrder !== undefined ? parseInt(body.sortOrder, 10) : 0;

    const country = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.country.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.country.create({
        data: {
          code,
          name: String(body.name).trim(),
          currency: String(body.currency).trim().toUpperCase(),
          currencySymbol: String(body.currencySymbol).trim(),
          locale: String(body.locale).trim(),
          timezone: String(body.timezone).trim(),
          isEnabled,
          isDefault,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        },
      });
    });

    return sendSuccess(res, country, 'Country created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.country.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Country not found', 404);

    const body: any = { ...req.body };
    const data: any = {};

    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!code) return sendError(res, 'code cannot be empty', 422);
      const clash = await prisma.country.findFirst({ where: { code, NOT: { id } } });
      if (clash) return sendError(res, `Country code "${code}" already exists`, 409);
      data.code = code;
    }
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.currency !== undefined) data.currency = String(body.currency).trim().toUpperCase();
    if (body.currencySymbol !== undefined) data.currencySymbol = String(body.currencySymbol).trim();
    if (body.locale !== undefined) data.locale = String(body.locale).trim();
    if (body.timezone !== undefined) data.timezone = String(body.timezone).trim();
    if (body.isEnabled !== undefined) data.isEnabled = parseBool(body.isEnabled);
    if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder, 10);

    const settingDefault = parseBool(body.isDefault);

    const country = await prisma.$transaction(async (tx) => {
      if (settingDefault === true) {
        await tx.country.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
        data.isDefault = true;
      } else if (settingDefault === false) {
        // Refuse to leave the platform with zero default countries — that
        // breaks every "no ?country= param" fallback at once.
        if (existing.isDefault) {
          throw Object.assign(new Error('DEFAULT_REQUIRED'), { isBusinessError: true });
        }
        data.isDefault = false;
      }
      return tx.country.update({ where: { id }, data });
    }).catch((err) => {
      if (err?.isBusinessError) return null;
      throw err;
    });

    if (!country) {
      return sendError(res, 'Cannot unset the default country — set a different country as default instead', 400);
    }

    return sendSuccess(res, country, 'Country updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.country.findUnique({ where: { id } });
    if (!existing) return sendError(res, 'Country not found', 404);

    // Deleting the default country would leave every "no ?country= param"
    // request with nothing to fall back to.
    if (existing.isDefault) {
      return sendError(res, 'Cannot delete the default country — set a different country as default first', 400);
    }

    // The FK on HomepageSection/Banner/CmsPage is ON DELETE SET NULL (a
    // nullable "Global -> Country" override reverts to Global rather than
    // blocking the delete); ProductCountryPricing/ProductCountryAvailability
    // are ON DELETE CASCADE, so their rows for this country go with it.
    await prisma.country.delete({ where: { id } });

    return sendSuccess(res, null, 'Country deleted');
  }
}

export const countryController = new CountryController();
