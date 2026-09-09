import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess } from '../../../utils/response';

/**
 * Money actually collected, as opposed to money invoiced.
 *
 * "Revenue" elsewhere in this panel sums `Order.total` where the order is
 * marked PAID, which answers a different question: an unpaid COD order for
 * ₹2,000 has a total of ₹2,000 and nothing in the bank. This report only ever
 * counts amounts that were genuinely received, from three separate places:
 *
 *   online payments   a settled gateway charge for the full order
 *   COD deposits      `isDeliveryChargeOnly` — only the delivery fee was taken
 *                     online; the goods are still owed in cash
 *   cash at the door  `Order.codCollected`, recorded when a delivery code is
 *                     verified — real money, but it never touches a gateway
 *                     and so appears in no payments row at all
 *
 * Refunds are subtracted, because a refunded charge is not a collection.
 */
export class AnalyticsController {
  async getDashboard(req: Request, res: Response) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalRevenue,
      todayRevenue,
      monthRevenue,
      totalOrders,
      pendingOrders,
      totalProducts,
      totalCustomers,
      recentOrders,
      topProducts,
      ordersByStatus,
      revenueByDay,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { paymentStatus: 'PAID', createdAt: { gte: startOfDay } },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { paymentStatus: 'PAID', createdAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: { totalSold: 'desc' },
        take: 10,
        select: {
          id: true, name: true, slug: true, totalSold: true, basePrice: true, salePrice: true,
          images: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      }),
      prisma.order.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      prisma.$queryRaw`
        SELECT
          DATE(createdAt) as date,
          CAST(SUM(total) AS DECIMAL(10,2)) as revenue,
          CAST(COUNT(*) AS UNSIGNED) as orders
        FROM orders
        WHERE createdAt >= ${last30Days} AND paymentStatus = 'PAID'
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      `,
    ]);

    return sendSuccess(res, {
      revenue: {
        total: totalRevenue._sum.total || 0,
        today: todayRevenue._sum.total || 0,
        month: monthRevenue._sum.total || 0,
      },
      orders: {
        total: totalOrders,
        pending: pendingOrders,
      },
      products: totalProducts,
      customers: totalCustomers,
      recentOrders,
      topProducts,
      ordersByStatus,
      revenueByDay,
    }, 'Dashboard data');
  }

  async getRevenueReport(req: Request, res: Response) {
    const { startDate, endDate } = req.query as Record<string, string>;

    const start = startDate ? new Date(startDate) : new Date('2020-01-01');
    const end = endDate ? new Date(endDate) : new Date();

    const data = await prisma.$queryRaw`
      SELECT
        DATE(createdAt) as date,
        CAST(COUNT(*) AS UNSIGNED) as orders,
        CAST(SUM(total) AS DECIMAL(10,2)) as revenue,
        CAST(SUM(discount) AS DECIMAL(10,2)) as discounts
      FROM orders
      WHERE paymentStatus = 'PAID'
        AND createdAt BETWEEN ${start} AND ${end}
      GROUP BY DATE(createdAt)
      ORDER BY date ASC
    `;

    return sendSuccess(res, data, 'Revenue report');
  }

  /** Successful collections only. Nothing pending, nothing failed. */
  async getTransactions(req: Request, res: Response) {
    const { startDate, endDate, method } = req.query as Record<string, string>;

    const range: any = {};
    if (startDate) range.gte = new Date(startDate);
    if (endDate) {
      // An end date names a whole day, not its first instant.
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    const hasRange = Object.keys(range).length > 0;

    const paymentWhere: any = { status: 'PAID' };
    if (hasRange) paymentWhere.updatedAt = range;
    if (method && method !== 'ALL') paymentWhere.method = method;

    const payments = await prisma.payment.findMany({
      where: paymentWhere,
      include: {
        order: {
          select: {
            id: true, orderNumber: true, total: true, paymentMethod: true,
            status: true, codCollected: true, createdAt: true,
            user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Cash taken at the door never produces a payments row, so it is gathered
    // separately or the report would under-count every self-delivered order.
    const cashWhere: any = { codCollected: { not: null } };
    if (hasRange) cashWhere.updatedAt = range;
    const cashOrders =
      !method || method === 'ALL' || method === 'COD'
        ? await prisma.order.findMany({
            where: cashWhere,
            select: {
              id: true, orderNumber: true, total: true, codCollected: true,
              updatedAt: true, deliveryDate: true,
              user: { select: { firstName: true, lastName: true, email: true, phone: true } },
            },
            orderBy: { updatedAt: 'desc' },
          })
        : [];

    const num = (v: unknown) => Number(v ?? 0);

    const rows = [
      ...payments.map(p => ({
        id: p.id,
        kind: p.isDeliveryChargeOnly ? 'COD_DEPOSIT' : 'ONLINE',
        collectedAt: p.updatedAt,
        amount: num(p.amount),
        refundAmount: num(p.refundAmount),
        method: p.method,
        reference: p.razorpayPaymentId || p.cashfreePaymentId || p.cashfreeOrderId || p.razorpayOrderId || null,
        orderId: p.order?.id ?? null,
        orderNumber: p.order?.orderNumber ?? null,
        orderTotal: num(p.order?.total),
        customer: p.order?.user
          ? { name: `${p.order.user.firstName} ${p.order.user.lastName}`.trim(), email: p.order.user.email, phone: p.order.user.phone }
          : null,
      })),
      ...cashOrders.map(o => ({
        id: `cash-${o.id}`,
        kind: 'COD_CASH' as const,
        collectedAt: o.deliveryDate ?? o.updatedAt,
        amount: num(o.codCollected),
        refundAmount: 0,
        method: 'COD',
        reference: null,
        orderId: o.id,
        orderNumber: o.orderNumber,
        orderTotal: num(o.total),
        customer: o.user
          ? { name: `${o.user.firstName} ${o.user.lastName}`.trim(), email: o.user.email, phone: o.user.phone }
          : null,
      })),
    ].sort((a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime());

    const sum = (kind: string) =>
      rows.filter(r => r.kind === kind).reduce((t, r) => t + r.amount, 0);

    const online = sum('ONLINE');
    const deposits = sum('COD_DEPOSIT');
    const cash = sum('COD_CASH');
    const refunded = rows.reduce((t, r) => t + r.refundAmount, 0);

    return sendSuccess(res, {
      rows,
      summary: {
        count: rows.length,
        online,
        deposits,
        cash,
        refunded,
        // What is genuinely in hand for the period.
        netCollected: online + deposits + cash - refunded,
      },
    }, 'Transactions fetched');
  }
}

export const analyticsController = new AnalyticsController();
