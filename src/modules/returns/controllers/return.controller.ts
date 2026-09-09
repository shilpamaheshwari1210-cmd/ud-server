import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../middlewares/error.middleware';
import { logger } from '../../../utils/logger';

/**
 * Returns are raised on Instagram, not here.
 *
 * The published policy makes Instagram the only support channel and requires
 * an unedited unboxing video, so customers cannot open a request from this
 * API — giving them a second route would leave the team watching two inboxes
 * and would contradict what the policy page tells them to do.
 *
 * What this does is make the outcome visible: the office records the request
 * after the DM, and the customer can then see where it has got to instead of
 * asking again.
 */
const ORDER_SUMMARY = {
  select: {
    id: true, orderNumber: true, total: true, status: true,
    deliveryDate: true, createdAt: true,
  },
};

export class ReturnController {
  /** The signed-in customer's own requests. Scoped by userId, not just role. */
  async getMyReturns(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);

    const returns = await prisma.returnRequest.findMany({
      where: { userId: req.user.userId },
      include: { order: ORDER_SUMMARY },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, returns, 'Returns fetched');
  }

  // ─── Admin ───────────────────────────────────────────────────────────

  async getAll(req: Request, res: Response) {
    const { status } = req.query as Record<string, string>;
    const where: any = {};
    if (status && status !== 'ALL') where.status = status;

    const returns = await prisma.returnRequest.findMany({
      where,
      include: {
        order: {
          select: {
            ...ORDER_SUMMARY.select,
            user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, returns, 'Returns fetched');
  }

  /**
   * Recorded by the office from an Instagram conversation, so the order is
   * looked up rather than trusted: the userId is taken from the order itself,
   * never from the request body, or a typo would file a return against the
   * wrong customer's account.
   */
  async create(req: Request, res: Response) {
    const { orderId, reason, description, refundAmount } = req.body;

    if (!orderId || !String(reason ?? '').trim()) {
      throw new AppError('An order and a reason are required', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, orderNumber: true },
    });
    if (!order) throw new AppError('Order not found', 404);

    const created = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        reason: String(reason).trim(),
        description: description ? String(description).trim() : null,
        ...(refundAmount != null && refundAmount !== '' && { refundAmount: Number(refundAmount) }),
      },
      include: { order: ORDER_SUMMARY },
    });

    logger.info('Return recorded', { returnId: created.id, orderNumber: order.orderNumber });
    return sendSuccess(res, created, 'Return recorded', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const { status, adminNote, refundAmount, reason, description } = req.body;

    const existing = await prisma.returnRequest.findUnique({ where: { id } });
    if (!existing) throw new AppError('Return request not found', 404);

    const VALID = ['REQUESTED', 'APPROVED', 'REJECTED', 'PICKED_UP', 'REFUNDED'];
    if (status && !VALID.includes(status)) {
      throw new AppError(`Status must be one of ${VALID.join(', ')}`, 400);
    }

    const updated = await prisma.returnRequest.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(adminNote !== undefined && { adminNote: adminNote || null }),
        ...(reason && { reason: String(reason).trim() }),
        ...(description !== undefined && { description: description || null }),
        ...(refundAmount !== undefined && {
          refundAmount: refundAmount === '' || refundAmount === null ? null : Number(refundAmount),
        }),
      },
      include: { order: ORDER_SUMMARY },
    });

    return sendSuccess(res, updated, 'Return updated');
  }

  async remove(req: Request, res: Response) {
    const { id } = req.params;
    const existing = await prisma.returnRequest.findUnique({ where: { id } });
    if (!existing) throw new AppError('Return request not found', 404);

    await prisma.returnRequest.delete({ where: { id } });
    return sendSuccess(res, null, 'Return deleted');
  }
}

export const returnController = new ReturnController();
export default returnController;
