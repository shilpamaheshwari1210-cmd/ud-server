import { Router } from 'express';
import { mediaController } from '../controllers/media.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';
import { createUploader } from '../../../utils/upload';

const router = Router();
const upload = createUploader('media');

router.get('/', authenticate, isAdmin, mediaController.getAll.bind(mediaController));
router.post('/upload', authenticate, isAdmin, upload.array('files', 20), mediaController.upload.bind(mediaController));
router.delete('/:id', authenticate, isAdmin, mediaController.delete.bind(mediaController));

export default router;
