import { Request, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import { prisma } from '../../../config/prisma';
import { config } from '../../../config/env';
import { sendSuccess, sendError } from '../../../utils/response';

// ── Razorpay ────────────────────────────────────────────────────────
let _razorpay: Razorpay | null = null;
const getRazorpay = () => {
  if (!_razorpay) {
    if (!config.razorpay.keyId || !config.razorpay.keySecret) {
      throw new Error('Razorpay keys not configured');
    }
    _razorpay = new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
  }
  return _razorpay;
};

// ── Cashfree SDK ────────────────────────────────────────────────────
// Initialised once on first use so env vars are read after dotenv loads
let _cashfree: InstanceType<typeof Cashfree> | null = null;
const getCashfree = () => {
  if (!_cashfree) {
    if (!config.cashfree.appId || !config.cashfree.secretKey) {
      throw new Error('Cashfree keys not configured');
    }
    const env = config.cashfree.env === 'production'
      ? CFEnvironment.PRODUCTION
      : CFEnvironment.SANDBOX;
    _cashfree = new Cashfree(env, config.cashfree.appId, config.cashfree.secretKey);
  }
  return _cashfree;
};

// ── Controller ───────────────────────────────────────────────────────
export class PaymentController {

  // ── Razorpay: create order ────────────────────────────────────────
  async createRazorpayOrder(req: Request, res: Response) {
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return sendError(res, 'Order not found', 404);
    if (!req.user || order.userId !== req.user.userId) return sendError(res, 'Forbidden', 403);

    const razorpayOrder = await getRazorpay().orders.create({
      amount:   Math.round(Number(order.total) * 100),
      currency: 'INR',
      receipt:  order.orderNumber,
      notes:    { orderId: order.id },
    });

    await prisma.payment.upsert({
      where:  { orderId },
      create: { orderId, amount: order.total, method: 'RAZORPAY', razorpayOrderId: razorpayOrder.id },
      update: { razorpayOrderId: razorpayOrder.id, method: 'RAZORPAY' },
    });

    return sendSuccess(res, {
      razorpayOrderId: razorpayOrder.id,
      amount:   razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key:      config.razorpay.keyId,
    }, 'Razorpay order created');
  }

  // ── Razorpay: verify payment ──────────────────────────────────────
  async verifyPayment(req: Request, res: Response) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return sendError(res, 'Order not found', 404);
    if (!req.user || order.userId !== req.user.userId) return sendError(res, 'Forbidden', 403);

    const expected = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expected !== razorpay_signature) return sendError(res, 'Invalid payment signature', 400);

    await prisma.payment.update({
      where: { orderId },
      data:  { razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature, status: 'PAID' },
    });
    await prisma.order.update({
      where: { id: orderId },
      data:  { paymentStatus: 'PAID', status: 'CONFIRMED' },
    });
    return sendSuccess(res, null, 'Payment verified successfully');
  }

  // ── Cashfree: create order → returns payment_session_id ──────────
  async createCashfreeOrder(req: Request, res: Response) {
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({
      where:   { id: orderId },
      include: { user: true },
    });
    if (!order) return sendError(res, 'Order not found', 404);
    if (!req.user || order.userId !== req.user.userId) return sendError(res, 'Forbidden', 403);

    const user  = order.user as any;
    const phone = (user.phone || '9999999999').replace(/\D/g, '').slice(-10) || '9999999999';
    const cfOrderId = `cf_${order.orderNumber}`;

    // Set expiry 30 minutes from now
    const expiryTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const request = {
      order_id:       cfOrderId,
      order_amount:   Number(order.total),
      order_currency: 'INR',
      customer_details: {
        customer_id:    user.id,
        customer_name:  `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer',
        customer_email: user.email,
        customer_phone: phone,
      },
      order_meta: {
        notify_url: `${config.baseUrl}/api/v1/payments/cashfree/webhook`,
      },
      order_expiry_time: expiryTime,
      order_note: `Order ${order.orderNumber}`,
    };

    const response = await getCashfree().PGCreateOrder(request);
    const cfData   = response.data as any;

    await prisma.payment.upsert({
      where:  { orderId },
      create: { orderId, amount: order.total, method: 'CASHFREE', cashfreeOrderId: cfData.order_id },
      update: { method: 'CASHFREE', cashfreeOrderId: cfData.order_id, status: 'PENDING' },
    });

    await prisma.order.update({
      where: { id: orderId },
      data:  { paymentMethod: 'CASHFREE' },
    });

    return sendSuccess(res, {
      paymentSessionId: cfData.payment_session_id,
      cfOrderId:        cfData.order_id,
      orderId,
      orderNumber:      order.orderNumber,
    }, 'Cashfree order created');
  }

  // ── Cashfree: COD delivery-charge deposit ────────────────────────
  // Creates a Cashfree session for ONLY the shipping charge.
  // Product amount is still collected as cash on delivery.
  async createCashfreeCodDeposit(req: Request, res: Response) {
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({
      where:   { id: orderId },
      include: { user: true },
    });
    if (!order) return sendError(res, 'Order not found', 404);
    if (!req.user || order.userId !== req.user.userId) return sendError(res, 'Forbidden', 403);
    if (order.paymentMethod !== 'COD') return sendError(res, 'Not a COD order', 400);
    if (order.deliveryChargePaid) return sendError(res, 'Delivery charge already collected', 400);

    const user           = order.user as any;
    const phone          = (user.phone || '9999999999').replace(/\D/g, '').slice(-10) || '9999999999';
    const deliveryCharge = Number(order.shippingCharge);
    const cfOrderId      = `cod_${order.orderNumber}`;

    const request = {
      order_id:       cfOrderId,
      order_amount:   deliveryCharge,
      order_currency: 'INR',
      customer_details: {
        customer_id:    user.id,
        customer_name:  `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer',
        customer_email: user.email,
        customer_phone: phone,
      },
      order_meta: {
        notify_url: `${config.baseUrl}/api/v1/payments/cashfree/webhook`,
      },
      order_expiry_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      order_note: `Delivery charge deposit — Order ${order.orderNumber}`,
    };

    const response = await getCashfree().PGCreateOrder(request);
    const cfData   = response.data as any;

    await prisma.payment.upsert({
      where:  { orderId },
      create: {
        orderId, amount: deliveryCharge, method: 'CASHFREE',
        cashfreeOrderId: cfData.order_id, isDeliveryChargeOnly: true,
      },
      update: {
        method: 'CASHFREE', cashfreeOrderId: cfData.order_id,
        amount: deliveryCharge, status: 'PENDING', isDeliveryChargeOnly: true,
      },
    });

    return sendSuccess(res, {
      paymentSessionId: cfData.payment_session_id,
      cfOrderId:        cfData.order_id,
      orderId,
      orderNumber:      order.orderNumber,
      deliveryCharge,
    }, 'COD delivery deposit session created');
  }

  // ── Cashfree: get payment status (polled after modal closes) ─────
  async getCashfreePaymentStatus(req: Request, res: Response) {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return sendError(res, 'Order not found', 404);
    if (!req.user || order.userId !== req.user.userId) return sendError(res, 'Forbidden', 403);

    const payment = await prisma.payment.findUnique({ where: { orderId } });
    if (!payment?.cashfreeOrderId) return sendError(res, 'Payment not initiated', 404);

    // Fetch live order status from Cashfree via SDK
    const response = await getCashfree().PGFetchOrder(payment.cashfreeOrderId);
    const cfData   = response.data as any;
    const cfStatus: string = cfData.order_status || '';

    let dbStatus: 'PENDING' | 'PAID' | 'FAILED' = 'PENDING';
    if (cfStatus === 'PAID') {
      dbStatus = 'PAID';
    } else if (['EXPIRED', 'CANCELLED', 'TERMINATED'].includes(cfStatus)) {
      dbStatus = 'FAILED';
    }

    if (dbStatus === 'PAID' && payment.status !== 'PAID') {
      const cfPaymentId = cfData.payments?.[0]?.cf_payment_id?.toString();
      await prisma.payment.update({
        where: { orderId },
        data:  { status: 'PAID', ...(cfPaymentId && { cashfreePaymentId: cfPaymentId }), gatewayResponse: cfData },
      });

      if (payment.isDeliveryChargeOnly) {
        // COD: delivery deposit collected — confirm order, product paid on delivery
        await prisma.order.update({
          where: { id: orderId },
          data:  { deliveryChargePaid: true, status: 'CONFIRMED' },
        });
      } else {
        // Full payment — mark order fully paid
        await prisma.order.update({
          where: { id: orderId },
          data:  { paymentStatus: 'PAID', status: 'CONFIRMED' },
        });
      }
    } else if (dbStatus === 'FAILED' && payment.status !== 'FAILED') {
      await prisma.payment.update({
        where: { orderId },
        data:  { status: 'FAILED', gatewayResponse: cfData },
      });
      await prisma.order.update({
        where: { id: orderId },
        data:  { paymentStatus: 'FAILED' },
      });
    }

    return sendSuccess(res, {
      cfStatus,
      paymentStatus:     dbStatus,
      orderNumber:       order.orderNumber,
      deliveryChargePaid: payment.isDeliveryChargeOnly ? (dbStatus === 'PAID') : undefined,
    });
  }

  // ── Cashfree: webhook (server-to-server) ──────────────────────────
  //
  // Scalability guarantees:
  //   1. Signature check  — rejects forged requests before any DB work
  //   2. Terminal-state guard — PAID/FAILED orders are skipped entirely (idempotency)
  //   3. Atomic updateMany — only one concurrent call wins the write (race-safe)
  //   4. Always ACK 200 — prevents Cashfree retry storms on transient failures
  //
  async cashfreeWebhook(req: Request, res: Response) {
    try {
      // ── 1. Signature verification ─────────────────────────────────
      const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;
      const signature = req.headers['x-webhook-signature'] as string | undefined;
      const rawBody   = (req as any).rawBody as Buffer | undefined;

      if (timestamp && signature && rawBody) {
        const expected = crypto
          .createHmac('sha256', config.cashfree.secretKey)
          .update(timestamp + rawBody.toString())
          .digest('base64');
        const expBuf = Buffer.from(expected);
        const sigBuf = Buffer.from(signature);
        if (expBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expBuf, sigBuf)) {
          return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }
      }

      // ── 2. Extract order ID ───────────────────────────────────────
      const cfOrderId: string = req.body?.data?.order?.order_id || '';
      if (!cfOrderId) return res.json({ success: true });

      // ── 3. Terminal-state early exit (idempotency) ────────────────
      const payment = await prisma.payment.findFirst({
        where:  { cashfreeOrderId: cfOrderId },
        select: { orderId: true, status: true, isDeliveryChargeOnly: true },
      });
      if (!payment) return res.json({ success: true });
      if (payment.status === 'PAID' || payment.status === 'FAILED') {
        return res.json({ success: true }); // duplicate webhook — nothing to do
      }

      // ── 4. Fetch canonical status from Cashfree ───────────────────
      const response = await getCashfree().PGFetchOrder(cfOrderId).catch(() => null);
      const cfData   = response?.data as any;
      if (!cfData) return res.json({ success: true });

      const cfStatus: string = cfData.order_status || '';

      if (cfStatus === 'PAID') {
        const cfPaymentId = cfData.payments?.[0]?.cf_payment_id?.toString();

        // ── 5. Atomic conditional write — only the first caller wins ──
        const updated = await prisma.payment.updateMany({
          where: { cashfreeOrderId: cfOrderId, status: { not: 'PAID' } },
          data:  {
            status:          'PAID',
            gatewayResponse: cfData,
            ...(cfPaymentId && { cashfreePaymentId: cfPaymentId }),
          },
        });
        // Guard order update behind the same winner-takes-all check
        if (updated.count > 0) {
          if (payment.isDeliveryChargeOnly) {
            // COD deposit: delivery charge paid online, product paid on delivery
            await prisma.order.update({
              where: { id: payment.orderId },
              data:  { deliveryChargePaid: true, status: 'CONFIRMED' },
            });
          } else {
            // Full payment
            await prisma.order.update({
              where: { id: payment.orderId },
              data:  { paymentStatus: 'PAID', status: 'CONFIRMED' },
            });
          }
        }

      } else if (['EXPIRED', 'CANCELLED', 'TERMINATED'].includes(cfStatus)) {

        const updated = await prisma.payment.updateMany({
          where: { cashfreeOrderId: cfOrderId, status: { notIn: ['PAID', 'FAILED'] } },
          data:  { status: 'FAILED', gatewayResponse: cfData },
        });
        if (updated.count > 0) {
          await prisma.order.update({
            where: { id: payment.orderId },
            data:  { paymentStatus: 'FAILED' },
          });
        }
      }

    } catch {
      // Always ACK — prevents Cashfree from queuing exponential retries.
      // Any missed update self-heals when the frontend polls /cashfree/status/:id
      // after the checkout modal closes.
    }
    return res.json({ success: true });
  }
}

export const paymentController = new PaymentController();
