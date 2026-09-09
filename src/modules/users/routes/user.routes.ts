import { Router } from 'express';
import { userController } from '../controllers/user.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';
import { createUploader } from '../../../utils/upload';

const router = Router();
const upload = createUploader('users');

router.put('/profile', authenticate, upload.single('avatar'), userController.updateProfile.bind(userController));
router.get('/addresses', authenticate, userController.getAddresses.bind(userController));
router.post('/addresses', authenticate, userController.addAddress.bind(userController));
router.put('/addresses/:id', authenticate, userController.updateAddress.bind(userController));
router.delete('/addresses/:id', authenticate, userController.deleteAddress.bind(userController));
router.get('/recently-viewed', authenticate, userController.getRecentlyViewed.bind(userController));
router.post('/recently-viewed', authenticate, userController.addRecentlyViewed.bind(userController));
router.get('/notifications', authenticate, userController.getNotifications.bind(userController));
router.put('/notifications/read', authenticate, userController.markNotificationsRead.bind(userController));

// Admin
router.get('/', authenticate, isAdmin, userController.getAllUsers.bind(userController));
router.put('/:id', authenticate, isAdmin, userController.updateUser.bind(userController));
router.put('/:id/toggle-status', authenticate, isAdmin, userController.toggleUserStatus.bind(userController));

export default router;
