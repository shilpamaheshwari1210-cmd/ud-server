import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticate } from '../../../middlewares/auth.middleware';

const router = Router();

// ── Razorpay ────────────────────────────────────────────────────────
router.post('/razorpay/create', authenticate, paymentController.createRazorpayOrder.bind(paymentController));
router.post('/razorpay/verify', authenticate, paymentController.verifyPayment.bind(paymentController));

// ── Cashfree ────────────────────────────────────────────────────────
// Webhook is public — Cashfree calls it server-to-server with no user token
router.post('/cashfree/webhook',              paymentController.cashfreeWebhook.bind(paymentController));
router.post('/cashfree/create',  authenticate, paymentController.createCashfreeOrder.bind(paymentController));
router.post('/cashfree/cod-deposit', authenticate, paymentController.createCashfreeCodDeposit.bind(paymentController));
router.get('/cashfree/status/:orderId', authenticate, paymentController.getCashfreePaymentStatus.bind(paymentController));

export default router;
