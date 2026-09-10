import { Router } from 'express';
import { roomController } from '../controllers/room.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/', roomController.getAll.bind(roomController));

// Admin — static path before '/:slug', per the '/admin/all' convention.
router.get('/admin/all', authenticate, isAdmin, roomController.getAllAdmin.bind(roomController));
router.post('/', authenticate, isAdmin, roomController.create.bind(roomController));
router.put('/:id', authenticate, isAdmin, roomController.update.bind(roomController));
router.delete('/:id', authenticate, isAdmin, roomController.delete.bind(roomController));

// Public — parameterised, after the static admin paths above.
router.get('/:slug', roomController.getBySlug.bind(roomController));

export default router;
