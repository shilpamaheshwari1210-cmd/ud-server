import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { authenticate, isAdminOrSubAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Customer routes
router.post('/', authenticate, orderController.createOrder.bind(orderController));
router.get('/my', authenticate, orderController.getMyOrders.bind(orderController));
router.get('/track/:orderNumber', orderController.trackOrder.bind(orderController));
// Static before parameterised: /orders/admin/:id must not be read as an id.
router.get('/admin/:id', authenticate, isAdminOrSubAdmin, orderController.getOrderByIdAdmin.bind(orderController));
router.get('/:id', authenticate, orderController.getOrderById.bind(orderController));
router.post('/:id/cancel', authenticate, orderController.cancelOrder.bind(orderController));

// Admin routes
router.get('/', authenticate, isAdminOrSubAdmin, orderController.getAllOrders.bind(orderController));
router.put('/:id/status', authenticate, isAdminOrSubAdmin, orderController.updateOrderStatus.bind(orderController));
router.put('/:id/fulfilment', authenticate, isAdminOrSubAdmin, orderController.updateFulfilment.bind(orderController));

// Delivery OTP — proof of handover on orders we carry ourselves.
router.get('/:id/delivery-otp',        authenticate, isAdminOrSubAdmin, orderController.getDeliveryOtpStatus.bind(orderController));
router.post('/:id/delivery-otp/send',  authenticate, isAdminOrSubAdmin, orderController.sendDeliveryOtp.bind(orderController));
router.post('/:id/delivery-otp/verify', authenticate, isAdminOrSubAdmin, orderController.verifyDeliveryOtp.bind(orderController));

export default router;
