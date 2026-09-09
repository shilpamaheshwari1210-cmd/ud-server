import { Router } from 'express';
import { categoryController } from '../controllers/category.controller';
import { authenticate, isAdmin, isAdminOrSubAdmin } from '../../../middlewares/auth.middleware';
import { createUploader } from '../../../utils/upload';

const router = Router();
const upload = createUploader('categories');

// Public
router.get('/',              categoryController.getAll.bind(categoryController));
router.get('/featured',      categoryController.getFeatured.bind(categoryController));
router.get('/nav-menu',      categoryController.getNavMenu.bind(categoryController));
router.get('/parents',       categoryController.getParents.bind(categoryController));
router.get('/home',          categoryController.getHomeCategories.bind(categoryController));
router.get('/:slug',         categoryController.getBySlug.bind(categoryController));

// Admin
// Before the parameterised routes, per the routing convention.
router.patch('/positions', authenticate, isAdminOrSubAdmin, categoryController.updatePositions.bind(categoryController));
router.post('/',    authenticate, isAdminOrSubAdmin, upload.single('image'), categoryController.create.bind(categoryController));
router.put('/:id',  authenticate, isAdminOrSubAdmin, upload.single('image'), categoryController.update.bind(categoryController));
router.delete('/:id', authenticate, isAdmin, categoryController.delete.bind(categoryController));

export default router;
