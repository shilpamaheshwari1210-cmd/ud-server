import { Router } from 'express';
import { returnController } from '../controllers/return.controller';
import { authenticate, isAdminOrSubAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Customer — own requests only. There is deliberately no POST here: returns
// are raised on Instagram, per the published policy.
router.get('/my', authenticate, returnController.getMyReturns.bind(returnController));

// Admin — static path before any parameterised sibling.
router.get('/', authenticate, isAdminOrSubAdmin, returnController.getAll.bind(returnController));
router.post('/', authenticate, isAdminOrSubAdmin, returnController.create.bind(returnController));
router.put('/:id', authenticate, isAdminOrSubAdmin, returnController.update.bind(returnController));
router.delete('/:id', authenticate, isAdminOrSubAdmin, returnController.remove.bind(returnController));

export default router;
