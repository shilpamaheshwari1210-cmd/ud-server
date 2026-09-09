import { Router } from 'express';
import { reviewController } from '../controllers/review.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

router.get('/product/:productId', reviewController.getProductReviews.bind(reviewController));
router.post('/', authenticate, reviewController.createReview.bind(reviewController));
router.get('/', authenticate, isAdmin, reviewController.getAllReviews.bind(reviewController));
router.put('/:id', authenticate, isAdmin, reviewController.updateReview.bind(reviewController));
router.delete('/:id', authenticate, isAdmin, reviewController.deleteReview.bind(reviewController));
router.put('/:id/status', authenticate, isAdmin, reviewController.updateReviewStatus.bind(reviewController));

export default router;
