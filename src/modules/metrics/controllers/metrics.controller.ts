import { Request, Response } from 'express';
import { logger } from '../../../utils/logger';
import { sendSuccess } from '../../../utils/response';

const VALID_NAMES = new Set(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']);

/**
 * Core Web Vitals field data (Phase 5 - Performance). This is deliberately
 * minimal -- no DB model, no dashboard, just structured log lines -- because
 * a real metrics/analytics platform is Phase 7's decision (tool choice: GA4/
 * Segment/PostHog/etc.), not something to half-build here. See
 * phase-5-performance-spec.md.
 */
export class MetricsController {
  async reportWebVitals(req: Request, res: Response) {
    const { name, value, id, rating, path, country } = req.body as Record<string, unknown>;

    // A public, unauthenticated endpoint fed by every visitor's browser --
    // validate the shape rather than trusting it, so a malformed/hostile
    // payload can't pollute the logs.
    if (typeof name !== 'string' || !VALID_NAMES.has(name) || typeof value !== 'number') {
      return sendSuccess(res, null, '');
    }

    logger.info('web-vital', {
      name, value, id, rating,
      path: typeof path === 'string' ? path.slice(0, 200) : undefined,
      country: typeof country === 'string' ? country.slice(0, 5) : undefined,
    });

    return sendSuccess(res, null, '');
  }
}

export const metricsController = new MetricsController();
