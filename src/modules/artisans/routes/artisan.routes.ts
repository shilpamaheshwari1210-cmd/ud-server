import { Router } from 'express';
import { artisanController } from '../controllers/artisan.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Admin — static paths before the public '/:id'.
router.get('/admin/all', authenticate, isAdmin, artisanController.getAllAdmin.bind(artisanController));
router.post('/', authenticate, isAdmin, artisanController.create.bind(artisanController));
router.put('/:id', authenticate, isAdmin, artisanController.update.bind(artisanController));
router.delete('/:id', authenticate, isAdmin, artisanController.delete.bind(artisanController));

// Public — static path before the '/:id' bio page.
router.get('/', artisanController.getAll.bind(artisanController));
router.get('/:id', artisanController.getById.bind(artisanController));

export default router;
