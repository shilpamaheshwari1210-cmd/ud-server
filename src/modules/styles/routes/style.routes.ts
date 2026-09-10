import { Router } from 'express';
import { styleController } from '../controllers/style.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/', styleController.getAll.bind(styleController));

// Admin — static path before '/:slug', per the '/admin/all' convention.
router.get('/admin/all', authenticate, isAdmin, styleController.getAllAdmin.bind(styleController));
router.post('/', authenticate, isAdmin, styleController.create.bind(styleController));
router.put('/:id', authenticate, isAdmin, styleController.update.bind(styleController));
router.delete('/:id', authenticate, isAdmin, styleController.delete.bind(styleController));

// Public — parameterised, after the static admin paths above.
router.get('/:slug', styleController.getBySlug.bind(styleController));

export default router;
