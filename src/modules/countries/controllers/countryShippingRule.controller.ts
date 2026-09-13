import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';

/**
 * CountryShippingRule admin CRUD — see
 * documentation/docs/architecture/phase-3-country-shipping-and-admin-spec.md.
 * Nested under a country: one rule per `method` per country, enforced by the
 * `@@unique([countryId, method])` constraint on the model. No rule is seeded
 * for any country by default — until an admin creates one here, that
 * country's orders keep resolving shipping through the existing flat-rate /
 * per-product-override chain in order.service.ts, unchanged.
 */

const METHODS = ['STANDARD', 'COD', 'EXPRESS'];

const parseBool = (v: any, fallback: boolean): boolean => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
};

const parseDecimal = (v: any): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('NOT_A_NUMBER');
  return n;
};

export class CountryShippingRuleController {
  private async requireCountry(countryId: string) {
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return null;
    return country;
  }

  /** Admin: every shipping rule configured for this country. */
  async getAll(req: Request, res: Response) {
    const { countryId } = req.params;
    const country = await this.requireCountry(countryId);
    if (!country) return sendError(res, 'Country not found', 404);

    const rules = await prisma.countryShippingRule.findMany({
      where: { countryId },
      orderBy: { method: 'asc' },
    });
    return sendSuccess(res, rules, 'Shipping rules fetched');
  }

  async create(req: Request, res: Response) {
    const { countryId } = req.params;
    const country = await this.requireCountry(countryId);
    if (!country) return sendError(res, 'Country not found', 404);

    const body: any = { ...req.body };
    const method = String(body.method ?? '').trim().toUpperCase();
    if (!method) return sendError(res, 'method is required', 422);
    if (!METHODS.includes(method)) {
      return sendError(res, `method must be one of: ${METHODS.join(', ')}`, 422);
    }
    if (body.cost === undefined || body.cost === null || body.cost === '') {
      return sendError(res, 'cost is required', 422);
    }

    const existing = await prisma.countryShippingRule.findUnique({
      where: { countryId_method: { countryId, method } },
    });
    if (existing) {
      return sendError(
        res,
        `A shipping rule for method "${method}" already exists for this country`,
        409,
      );
    }

    let cost: number;
    let freeShippingThreshold: number | null;
    try {
      cost = parseDecimal(body.cost);
      freeShippingThreshold =
        body.freeShippingThreshold === undefined || body.freeShippingThreshold === null || body.freeShippingThreshold === ''
          ? null
          : parseDecimal(body.freeShippingThreshold);
    } catch {
      return sendError(res, 'cost and freeShippingThreshold must be numbers', 422);
    }

    const rule = await prisma.countryShippingRule.create({
      data: {
        countryId,
        method,
        cost,
        freeShippingThreshold,
        estimatedDaysMin: body.estimatedDaysMin !== undefined && body.estimatedDaysMin !== '' ? parseInt(body.estimatedDaysMin, 10) : null,
        estimatedDaysMax: body.estimatedDaysMax !== undefined && body.estimatedDaysMax !== '' ? parseInt(body.estimatedDaysMax, 10) : null,
        customsMessage: body.customsMessage || null,
        isActive: parseBool(body.isActive, true),
      },
    });
    return sendSuccess(res, rule, 'Shipping rule created', 201);
  }

  async update(req: Request, res: Response) {
    const { countryId, id } = req.params;
    const existing = await prisma.countryShippingRule.findFirst({ where: { id, countryId } });
    if (!existing) return sendError(res, 'Shipping rule not found', 404);

    const body: any = { ...req.body };
    const data: any = {};

    if (body.method !== undefined) {
      const method = String(body.method).trim().toUpperCase();
      if (!METHODS.includes(method)) {
        return sendError(res, `method must be one of: ${METHODS.join(', ')}`, 422);
      }
      if (method !== existing.method) {
        const clash = await prisma.countryShippingRule.findUnique({
          where: { countryId_method: { countryId, method } },
        });
        if (clash) {
          return sendError(
            res,
            `A shipping rule for method "${method}" already exists for this country`,
            409,
          );
        }
      }
      data.method = method;
    }

    try {
      if (body.cost !== undefined) data.cost = parseDecimal(body.cost);
      if (body.freeShippingThreshold !== undefined) {
        data.freeShippingThreshold = body.freeShippingThreshold === null || body.freeShippingThreshold === ''
          ? null
          : parseDecimal(body.freeShippingThreshold);
      }
    } catch {
      return sendError(res, 'cost and freeShippingThreshold must be numbers', 422);
    }

    if (body.estimatedDaysMin !== undefined) {
      data.estimatedDaysMin = body.estimatedDaysMin === null || body.estimatedDaysMin === '' ? null : parseInt(body.estimatedDaysMin, 10);
    }
    if (body.estimatedDaysMax !== undefined) {
      data.estimatedDaysMax = body.estimatedDaysMax === null || body.estimatedDaysMax === '' ? null : parseInt(body.estimatedDaysMax, 10);
    }
    if (body.customsMessage !== undefined) data.customsMessage = body.customsMessage || null;
    if (body.isActive !== undefined) data.isActive = parseBool(body.isActive, existing.isActive);

    const rule = await prisma.countryShippingRule.update({ where: { id }, data });
    return sendSuccess(res, rule, 'Shipping rule updated');
  }

  async delete(req: Request, res: Response) {
    const { countryId, id } = req.params;
    const existing = await prisma.countryShippingRule.findFirst({ where: { id, countryId } });
    if (!existing) return sendError(res, 'Shipping rule not found', 404);

    await prisma.countryShippingRule.delete({ where: { id } });
    return sendSuccess(res, null, 'Shipping rule deleted');
  }
}

export const countryShippingRuleController = new CountryShippingRuleController();
