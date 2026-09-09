import { Router } from 'express';
import { blogController } from '../controllers/blog.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';
import { createUploader } from '../../../utils/upload';

const router = Router();
const upload = createUploader('blogs');

router.get('/', blogController.getPublished.bind(blogController));
router.get('/categories', blogController.getCategories.bind(blogController));
router.get('/:slug', blogController.getBySlug.bind(blogController));

router.get('/admin/all', authenticate, isAdmin, blogController.getAllAdmin.bind(blogController));
router.post('/', authenticate, isAdmin, upload.single('image'), blogController.create.bind(blogController));
router.put('/:id', authenticate, isAdmin, upload.single('image'), blogController.update.bind(blogController));
router.delete('/:id', authenticate, isAdmin, blogController.delete.bind(blogController));

export default router;
