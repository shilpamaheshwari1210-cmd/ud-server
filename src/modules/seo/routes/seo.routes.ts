import { Router } from 'express';
import { seoController } from '../controllers/seo.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

router.get('/page/:page', seoController.getByPage.bind(seoController));
router.get('/cms/:slug', seoController.getCmsPage.bind(seoController));

router.get('/admin/all', authenticate, isAdmin, seoController.getAll.bind(seoController));
router.put('/admin/:id', authenticate, isAdmin, seoController.update.bind(seoController));
router.post('/admin/upsert', authenticate, isAdmin, seoController.upsert.bind(seoController));
router.get('/admin/cms', authenticate, isAdmin, seoController.getAllCmsPages.bind(seoController));
router.post('/admin/cms', authenticate, isAdmin, seoController.upsertCmsPage.bind(seoController));

export default router;
