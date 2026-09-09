import { Request, Response } from 'express';
import { orderService } from '../services/order.service';
import { deliveryOtpService } from '../services/deliveryOtp.service';
import { sendSuccess, sendPaginated, sendError } from '../../../utils/response';

export class OrderController {
  async createOrder(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const order = await orderService.createOrder(req.user.userId, req.body);
    return sendSuccess(res, order, 'Order placed successfully', 201);
  }

  async getMyOrders(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { page, limit } = req.query as Record<string, string>;
    const result = await orderService.getUserOrders(req.user.userId, Number(page), Number(limit));
    return sendPaginated(res, result.orders, result.total, result.page, result.limit);
  }

  async getOrderById(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const order = await orderService.getOrderById(req.params.id, req.user.userId);
    return sendSuccess(res, order, 'Order fetched');
  }

  async trackOrder(req: Request, res: Response) {
    const order = await orderService.getOrderByNumber(req.params.orderNumber);
    return sendSuccess(res, order, 'Order tracked');
  }

  async cancelOrder(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { reason } = req.body;
    const order = await orderService.cancelOrder(req.params.id, req.user.userId, reason);
    return sendSuccess(res, order, 'Order cancelled');
  }

  // Admin
  async getOrderByIdAdmin(req: Request, res: Response) {
    // No userId: an admin reads any order. The role guard on the route is what
    // authorises it, which is why this is a separate endpoint rather than a
    // branch inside the customer-scoped one.
    const order = await orderService.getOrderById(req.params.id);
    return sendSuccess(res, order, 'Order fetched');
  }

  async getAllOrders(req: Request, res: Response) {
    const { page, limit, status, paymentStatus, fulfilmentType, search, startDate, endDate } = req.query as Record<string, string>;
    const result = await orderService.getAllOrders(Number(page), Number(limit), { status, paymentStatus, fulfilmentType, search, startDate, endDate });
    return sendPaginated(res, result.orders, result.total, result.page, result.limit);
  }

  async updateFulfilment(req: Request, res: Response) {
    const { fulfilmentType } = req.body;
    if (fulfilmentType && !['SELF', 'DELHIVERY'].includes(fulfilmentType)) {
      return sendError(res, 'fulfilmentType must be SELF or DELHIVERY', 400);
    }
    const order = await orderService.updateFulfilment(req.params.id, req.body);
    return sendSuccess(res, order, 'Delivery method updated');
  }

  async updateOrderStatus(req: Request, res: Response) {
    const { id } = req.params;
    const { status, trackingNumber, trackingUrl, overrideReason } = req.body;
    const order = await orderService.updateOrderStatus(id, status, trackingNumber, trackingUrl, {
      role: req.user?.dbRole,
      overrideReason,
    });
    return sendSuccess(res, order, 'Order status updated');
  }

  // ─── Delivery OTP (self-delivered orders) ──────────────────────────────
  // The code itself is never in a response body. The office learns it from
  // the customer, not from this API.

  async getDeliveryOtpStatus(req: Request, res: Response) {
    const status = await deliveryOtpService.status(req.params.id);
    return sendSuccess(res, status);
  }

  async sendDeliveryOtp(req: Request, res: Response) {
    const result = await deliveryOtpService.send(req.params.id);
    return sendSuccess(res, result, `Code sent to the customer (${result.sentTo})`);
  }

  async verifyDeliveryOtp(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { otp, codCollected } = req.body;
    if (!otp) return sendError(res, 'Enter the code the customer read out', 400);

    const cod = codCollected === undefined || codCollected === null || codCollected === ''
      ? null
      : Number(codCollected);
    if (cod !== null && !Number.isFinite(cod)) {
      return sendError(res, 'Cash collected must be a number', 400);
    }

    const order = await deliveryOtpService.verify(req.params.id, String(otp), req.user.userId, cod);
    return sendSuccess(res, order, 'Code verified — order marked delivered');
  }
}

export const orderController = new OrderController();
