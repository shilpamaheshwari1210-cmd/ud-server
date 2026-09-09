import { Router } from 'express';
import { cartController } from '../controllers/cart.controller';
import { authenticate } from '../../../middlewares/auth.middleware';

const router = Router();

const optionalAuth = (req: any, res: any, next: any) => {
  const header = req.headers.authorization;
  if (header) return authenticate(req, res, next);
  return next();
};

router.get('/', optionalAuth, cartController.getCart.bind(cartController));
router.post('/add', optionalAuth, cartController.addItem.bind(cartController));
router.put('/item/:itemId', optionalAuth, cartController.updateItem.bind(cartController));
router.delete('/item/:itemId', optionalAuth, cartController.removeItem.bind(cartController));
router.delete('/clear', optionalAuth, cartController.clearCart.bind(cartController));
router.post('/coupon', optionalAuth, cartController.applyCoupon.bind(cartController));

export default router;
