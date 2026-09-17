import { Router } from 'express';
import { metricsController } from '../controllers/metrics.controller';

const router = Router();

// Public: every visitor's browser reports its own Core Web Vitals, signed-in
// or not.
router.post('/web-vitals', metricsController.reportWebVitals.bind(metricsController));

export default router;
