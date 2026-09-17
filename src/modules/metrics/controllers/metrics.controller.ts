import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { logger } from '../../../utils/logger';
import { sendSuccess } from '../../../utils/response';
import { resolveCountryIdForBrowsing } from '../../../utils/countryPricing';

const VALID_NAMES = new Set(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']);

const VALID_EVENT_NAMES = new Set([
  'PAGE_VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'ORDER_PLACED',
]);

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

  /**
   * The in-house funnel event log (Phase 7 - Analytics) -- see
   * phase-7-analytics-spec.md for why this is a deliberately minimal
   * alternative to a real analytics platform, not a placeholder for one.
   */
  async reportEvent(req: Request, res: Response) {
    const { name, sessionId, path, productId, country } = req.body as Record<string, unknown>;

    // Public, unauthenticated, fed by every visitor's browser -- validate
    // the shape, same posture as reportWebVitals above.
    if (typeof name !== 'string' || !VALID_EVENT_NAMES.has(name)) {
      return sendSuccess(res, null, '');
    }

    const countryId = typeof country === 'string' ? await resolveCountryIdForBrowsing(country) : null;

    await prisma.analyticsEvent.create({
      data: {
        name,
        sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 100) : undefined,
        userId: req.user?.userId,
        path: typeof path === 'string' ? path.slice(0, 200) : undefined,
        productId: typeof productId === 'string' ? productId.slice(0, 100) : undefined,
        countryId: countryId ?? undefined,
      },
    });

    return sendSuccess(res, null, '');
  }
}

export const metricsController = new MetricsController();
