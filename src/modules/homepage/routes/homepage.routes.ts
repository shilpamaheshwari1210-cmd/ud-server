import { Router } from 'express';
import { homepageController } from '../controllers/homepage.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

router.get('/', homepageController.getSections.bind(homepageController));
router.get('/data', homepageController.getFullHomepageData.bind(homepageController));

router.get('/admin', authenticate, isAdmin, homepageController.getAllSections.bind(homepageController));
router.post('/', authenticate, isAdmin, homepageController.createSection.bind(homepageController));
router.put('/reorder', authenticate, isAdmin, homepageController.reorderSections.bind(homepageController));
router.put('/:id', authenticate, isAdmin, homepageController.updateSection.bind(homepageController));
router.delete('/:id', authenticate, isAdmin, homepageController.deleteSection.bind(homepageController));

export default router;
