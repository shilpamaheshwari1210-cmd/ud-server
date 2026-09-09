import { Router } from 'express';
import { couponController } from '../controllers/coupon.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Public
router.post('/validate', couponController.validate.bind(couponController));
router.get('/:code/check', couponController.getByCode.bind(couponController));

// Admin
router.get('/', authenticate, isAdmin, couponController.getAll.bind(couponController));
router.post('/', authenticate, isAdmin, couponController.create.bind(couponController));
router.put('/:id', authenticate, isAdmin, couponController.update.bind(couponController));
router.delete('/:id', authenticate, isAdmin, couponController.delete.bind(couponController));

export default router;
