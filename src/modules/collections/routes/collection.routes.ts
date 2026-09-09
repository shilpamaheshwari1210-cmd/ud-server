import { Router } from 'express';
import { collectionController } from '../controllers/collection.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';
import { createUploader } from '../../../utils/upload';

const router = Router();
const upload = createUploader('categories');

// Two images per collection: the card shot and the wide hero banner behind the
// title on the collection page.
const acceptImages = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'bannerImage', maxCount: 1 },
]);

// Public
router.get('/', collectionController.getAll.bind(collectionController));
router.get('/:slug', collectionController.getBySlug.bind(collectionController));

// Admin
router.post('/', authenticate, isAdmin, acceptImages, collectionController.create.bind(collectionController));
router.put('/:id', authenticate, isAdmin, acceptImages, collectionController.update.bind(collectionController));
router.delete('/:id', authenticate, isAdmin, collectionController.delete.bind(collectionController));

// Collection ↔ Product management
router.get('/:id/products', authenticate, isAdmin, collectionController.getProducts.bind(collectionController));
router.post('/:id/products', authenticate, isAdmin, collectionController.addProduct.bind(collectionController));
router.delete('/:id/products/:productId', authenticate, isAdmin, collectionController.removeProduct.bind(collectionController));

export default router;
