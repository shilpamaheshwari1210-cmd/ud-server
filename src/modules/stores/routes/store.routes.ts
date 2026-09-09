import { Router, Request, Response, NextFunction } from 'express';
import { storeController } from '../controllers/store.controller';
import { authenticate, isAdmin } from '../../../middlewares/auth.middleware';
import { createUploader } from '../../../utils/upload';
import multer from 'multer';

const router = Router();
const upload = createUploader('stores', 2 * 1024 * 1024); // 2 MB limit

const handleUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('image')(req, res, (err: any) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Image must be 2 MB or smaller.' });
    }
    if (err) return next(err);
    next();
  });
};

// Public
router.get('/', storeController.getAll.bind(storeController));

// Admin
router.get('/admin', authenticate, isAdmin, storeController.getAllAdmin.bind(storeController));
router.post('/', authenticate, isAdmin, handleUpload, storeController.create.bind(storeController));
router.put('/reorder', authenticate, isAdmin, storeController.reorder.bind(storeController));
router.put('/:id', authenticate, isAdmin, handleUpload, storeController.update.bind(storeController));
router.delete('/:id', authenticate, isAdmin, storeController.delete.bind(storeController));

export default router;
