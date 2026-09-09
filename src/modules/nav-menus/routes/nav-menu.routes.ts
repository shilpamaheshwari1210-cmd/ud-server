import { Router } from 'express';
import { navMenuController } from '../controllers/nav-menu.controller';
import { authenticate, isAdminOrSubAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/', navMenuController.getByPosition.bind(navMenuController));

// Admin — static paths before the parameterised ones.
router.get('/admin', authenticate, isAdminOrSubAdmin, navMenuController.getAll.bind(navMenuController));
router.patch('/positions', authenticate, isAdminOrSubAdmin, navMenuController.updatePositions.bind(navMenuController));
router.post('/import-defaults', authenticate, isAdminOrSubAdmin, navMenuController.importDefaults.bind(navMenuController));
router.post('/', authenticate, isAdminOrSubAdmin, navMenuController.create.bind(navMenuController));
router.put('/:id', authenticate, isAdminOrSubAdmin, navMenuController.update.bind(navMenuController));
router.delete('/:id', authenticate, isAdminOrSubAdmin, navMenuController.delete.bind(navMenuController));

export default router;
