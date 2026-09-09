import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendPaginated } from '../../../utils/response';
import { paginationParams } from '../../../utils/slugify';

export class CouponController {
  async getAll(req: Request, res: Response) {
    const { page, limit, search, isActive } = req.query as Record<string, string>;
    const where: any = {};
    if (search) where.code = { contains: search.toUpperCase() };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const { page: p, limit: l, skip } = paginationParams(page, limit);
    const [data, total] = await Promise.all([
      prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: l }),
      prisma.coupon.count({ where }),
    ]);
    return sendPaginated(res, data, total, p, l, 'Coupons fetched');
  }

  async getByCode(req: Request, res: Response) {
    const { code } = req.params;
    const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!coupon) return sendSuccess(res, null, 'Coupon not found', 404);
    return sendSuccess(res, coupon, 'Coupon fetched');
  }

  async create(req: Request, res: Response) {
    const data = { ...req.body, code: req.body.code?.toUpperCase() };
    const coupon = await prisma.coupon.create({ data });
    return sendSuccess(res, coupon, 'Coupon created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const data: any = { ...req.body };
    if (data.code) data.code = data.code.toUpperCase();
    const coupon = await prisma.coupon.update({ where: { id }, data });
    return sendSuccess(res, coupon, 'Coupon updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    await prisma.coupon.delete({ where: { id } });
    return sendSuccess(res, null, 'Coupon deleted');
  }

  async validate(req: Request, res: Response) {
    const { code, cartTotal } = req.body;
    const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!coupon || !coupon.isActive) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive coupon' });
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'Coupon expired' });
    }
    if (coupon.minOrderAmount && Number(cartTotal) < Number(coupon.minOrderAmount)) {
      return res.status(400).json({ success: false, message: `Minimum order amount is ₹${coupon.minOrderAmount}` });
    }
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    }
    return sendSuccess(res, coupon, 'Coupon is valid');
  }
}

export const couponController = new CouponController();
