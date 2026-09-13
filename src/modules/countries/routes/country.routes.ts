import { Router } from 'express';
import { countryController } from '../controllers/country.controller';
import { countryShippingRuleController } from '../controllers/countryShippingRule.controller';
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

// Admin — nested shipping-rule CRUD, one rule per method per country
// (@@unique([countryId, method])). See
// documentation/docs/architecture/phase-3-country-shipping-and-admin-spec.md.
router.get('/:countryId/shipping-rules', authenticate, isAdmin, countryShippingRuleController.getAll.bind(countryShippingRuleController));
router.post('/:countryId/shipping-rules', authenticate, isAdmin, countryShippingRuleController.create.bind(countryShippingRuleController));
router.put('/:countryId/shipping-rules/:id', authenticate, isAdmin, countryShippingRuleController.update.bind(countryShippingRuleController));
router.delete('/:countryId/shipping-rules/:id', authenticate, isAdmin, countryShippingRuleController.delete.bind(countryShippingRuleController));

export default router;
