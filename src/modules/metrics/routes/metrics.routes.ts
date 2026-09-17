import { Router } from 'express';
import { metricsController } from '../controllers/metrics.controller';

const router = Router();

// Public: every visitor's browser reports its own Core Web Vitals, signed-in
// or not.
router.post('/web-vitals', metricsController.reportWebVitals.bind(metricsController));

// Public: funnel events (Phase 7 - Analytics), signed-in or not -- the whole
// point is capturing guest browsing too.
router.post('/event', metricsController.reportEvent.bind(metricsController));

export default router;
