import { Router } from 'express';
import { wishlistController } from '../controllers/wishlist.controller';
import { authenticate } from '../../../middlewares/auth.middleware';

const router = Router();

router.get('/', authenticate, wishlistController.getWishlist.bind(wishlistController));
router.post('/toggle', authenticate, wishlistController.toggle.bind(wishlistController));
router.get('/check/:productId', authenticate, wishlistController.check.bind(wishlistController));

export default router;
