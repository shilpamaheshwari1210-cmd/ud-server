import { Router } from 'express';
import { productController } from '../controllers/product.controller';
import { authenticate, isAdmin, isAdminOrSubAdmin } from '../../../middlewares/auth.middleware';
import { createUploader, validateUploadResolution } from '../../../utils/upload';

const router = Router();
const upload = createUploader('products');
// Rejects sources too small for the grid/detail views, which the pipeline
// cannot compensate for because it never upscales.
const checkResolution = validateUploadResolution('products');

// Public routes
router.get('/', productController.getProducts.bind(productController));
router.get('/featured', productController.getFeaturedProducts.bind(productController));
router.get('/trending', productController.getTrendingProducts.bind(productController));
router.get('/new-arrivals', productController.getNewArrivals.bind(productController));
router.get('/best-sellers', productController.getBestSellers.bind(productController));
router.get('/search', productController.search.bind(productController));
router.get('/:slug', productController.getProductBySlug.bind(productController));

// Admin routes
// MUST precede '/admin/:id', otherwise "list" is captured as an id.
router.get('/admin/list', authenticate, isAdminOrSubAdmin, productController.getAdminProducts.bind(productController));
// Also before '/admin/:id' — "export" would otherwise be read as a product id.
router.get('/admin/export', authenticate, isAdminOrSubAdmin, productController.exportAdminProducts.bind(productController));
router.get('/admin/:id', authenticate, isAdminOrSubAdmin, productController.getProductById.bind(productController));
// MUST precede '/:id' routes so "positions" is not captured as an id.
router.patch('/positions', authenticate, isAdminOrSubAdmin, productController.updatePositions.bind(productController));
router.post('/', authenticate, isAdminOrSubAdmin, upload.array('images', 10), checkResolution, productController.createProduct.bind(productController));
router.put('/:id', authenticate, isAdminOrSubAdmin, upload.array('images', 10), checkResolution, productController.updateProduct.bind(productController));
router.delete('/:id', authenticate, isAdmin, productController.deleteProduct.bind(productController));

// Variant routes
router.get('/:id/variants', authenticate, isAdminOrSubAdmin, productController.getVariants.bind(productController));
router.post('/:id/variants', authenticate, isAdminOrSubAdmin, productController.createVariant.bind(productController));
router.put('/:id/variants/:vid', authenticate, isAdminOrSubAdmin, productController.updateVariant.bind(productController));
router.delete('/:id/variants/:vid', authenticate, isAdmin, productController.deleteVariant.bind(productController));

export default router;
