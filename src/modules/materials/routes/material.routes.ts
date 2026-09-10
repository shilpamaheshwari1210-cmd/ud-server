import { Router } from 'express';
import { materialController } from '../controllers/material.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/', materialController.getAll.bind(materialController));

// Admin — static path before '/:slug', per the '/admin/all' convention.
router.get('/admin/all', authenticate, isAdmin, materialController.getAllAdmin.bind(materialController));
router.post('/', authenticate, isAdmin, materialController.create.bind(materialController));
router.put('/:id', authenticate, isAdmin, materialController.update.bind(materialController));
router.delete('/:id', authenticate, isAdmin, materialController.delete.bind(materialController));

// Public — parameterised, after the static admin paths above.
router.get('/:slug', materialController.getBySlug.bind(materialController));

export default router;
