import { Router } from 'express';
import { imageController } from '../controllers/image.controller';

const router = Router();

// Static prefix must be registered before the catch-all, otherwise `/meta/...`
// would be swallowed by the wildcard and treated as an image path.
router.get(/^\/meta\/(.*)/, imageController.meta.bind(imageController));

// Wildcard: everything after /img/ is the path of the source file relative to
// the uploads root. A RegExp is used rather than '/*' because Express 4 does
// not expose the captured segment as a named param for the latter.
router.get(/^\/(.*)/, imageController.serve.bind(imageController));

export default router;
