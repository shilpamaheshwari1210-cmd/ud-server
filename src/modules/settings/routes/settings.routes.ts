import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';

const router = Router();

router.get('/public', settingsController.getPublicSettings.bind(settingsController));
router.get('/', authenticate, isAdmin, settingsController.getAllSettings.bind(settingsController));
router.get('/:group', authenticate, isAdmin, settingsController.getByGroup.bind(settingsController));
router.post('/', authenticate, isAdmin, settingsController.upsertSetting.bind(settingsController));
router.post('/bulk', authenticate, isAdmin, settingsController.upsertBulk.bind(settingsController));

export default router;
