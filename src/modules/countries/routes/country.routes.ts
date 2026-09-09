import { Router } from 'express';
import { countryController } from '../controllers/country.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

// Public — enabled markets only, for the (future) frontend country selector.
router.get('/', countryController.getEnabled.bind(countryController));

// Admin — every market, enabled or not. Static path before any future '/:id'
// GET, matching the '/admin/all' convention used by blogs/products/etc.
router.get('/admin/all', authenticate, isAdmin, countryController.getAllAdmin.bind(countryController));
router.post('/', authenticate, isAdmin, countryController.create.bind(countryController));
router.put('/:id', authenticate, isAdmin, countryController.update.bind(countryController));
router.delete('/:id', authenticate, isAdmin, countryController.delete.bind(countryController));

export default router;
