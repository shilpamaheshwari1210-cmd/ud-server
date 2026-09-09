import crypto from 'crypto';
import { prisma } from '../../../config/prisma';
import { config } from '../../../config/env';
import { AppError } from '../../../middlewares/error.middleware';
import { sendMail, isMailConfigured, missingMailConfig } from '../../../config/mailer';
import { deliveryCodeEmail } from '../../../emails/deliveryCode.template';
import { logger } from '../../../utils/logger';

/**
 * Proof of delivery for parcels we carry ourselves.
 *
 * The office sends a code to the customer, the customer reads it out to the
 * person at their door, that person relays it back to the office on the phone,
 * and the office types it in. The parcel is handed over only once the panel
 * says the code was right.
 *
 * The code is never returned by any endpoint and never shown in the panel —
 * only its hash is stored. An admin who could read the code could confirm a
 * delivery that never happened, which is exactly what this exists to prevent.
 */

const OTP_LENGTH        = 6;
const TTL_MINUTES       = 10;
const RESEND_COOLDOWN_S = 60;
const MAX_SENDS         = 5;   // per order, per code lifecycle
const MAX_ATTEMPTS      = 5;   // wrong guesses before the code is burned

/** Statuses from which a parcel can plausibly be at someone's door. */
const SENDABLE_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'];

export interface OtpSendResult {
  channel: 'EMAIL';
  sentTo: string;            // masked
  expiresAt: Date;
  resendAvailableAt: Date;
  sendsRemaining: number;
}

export class DeliveryOtpService {
  /** A 6-digit code from a real CSPRNG, leading zeros kept. */
  private generateCode(): string {
    const max = 10 ** OTP_LENGTH;
    return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
  }

  /**
   * Salted with the order id so a hash lifted from one row cannot be replayed
   * against another, and keyed with the server secret so a database dump alone
   * cannot be brute-forced offline (a 6-digit space is tiny).
   */
  private hash(orderId: string, code: string): string {
    return crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${orderId}:${code}`)
      .digest('hex');
  }

  private matches(orderId: string, code: string, stored: string): boolean {
    const candidate = Buffer.from(this.hash(orderId, code), 'utf8');
    const expected  = Buffer.from(stored, 'utf8');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  }

  /** j***n@gmail.com — enough for the office to confirm the right inbox, no more. */
  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain) return '***';
    const shown = name.length <= 2 ? name[0] : `${name[0]}***${name[name.length - 1]}`;
    return `${shown}@${domain}`;
  }

  private async loadOrder(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!order) throw new AppError('Order not found', 404);
    return order;
  }

  /**
   * Where the code goes. The account email is authoritative — the address
   * snapshot on the order has no email field, and the account is the one the
   * customer can actually open.
   */
  private recipient(order: any): { email: string; name: string } {
    const email = String(order.user?.email ?? '').trim();
    if (!email) {
      throw new AppError(
        'This customer has no email address on file, so a delivery code cannot be sent.',
        400,
      );
    }
    const name = [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ')
      || String((order.shippingAddress as any)?.firstName ?? 'there');
    return { email, name };
  }

  async send(orderId: string): Promise<OtpSendResult> {
    const order = await this.loadOrder(orderId);

    if (order.fulfilmentType !== 'SELF') {
      throw new AppError(
        'Delivery codes are only for orders we deliver ourselves. Switch the delivery method to Self delivery first.',
        400,
      );
    }
    if (order.deliveryOtpVerifiedAt) {
      throw new AppError('This order has already been confirmed with a delivery code.', 400);
    }
    if (!SENDABLE_STATUSES.includes(order.status)) {
      throw new AppError(`An order marked ${order.status} cannot be handed over.`, 400);
    }
    if (!isMailConfigured()) {
      throw new AppError(
        `Email is not set up on the server yet, so the code cannot be sent. Set ${missingMailConfig().join(' ')}.`,
        503,
      );
    }

    const now = new Date();

    // A live code is not replaced on every click: the customer may already be
    // reading it out. The cooldown also stops the office mailbombing someone.
    if (order.deliveryOtpSentAt) {
      const waitedMs = now.getTime() - order.deliveryOtpSentAt.getTime();
      if (waitedMs < RESEND_COOLDOWN_S * 1000) {
        const seconds = Math.ceil((RESEND_COOLDOWN_S * 1000 - waitedMs) / 1000);
        throw new AppError(`A code was just sent. Try again in ${seconds}s.`, 429);
      }
    }
    if (order.deliveryOtpSentCount >= MAX_SENDS) {
      throw new AppError(
        `A code has already been sent ${MAX_SENDS} times for this order. Check with the customer before trying again.`,
        429,
      );
    }

    const { email, name } = this.recipient(order);
    const code      = this.generateCode();
    const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);

    const mail = deliveryCodeEmail({
      customerName: name,
      orderNumber:  order.orderNumber,
      otp:          code,
      minutesValid: TTL_MINUTES,
    });

    // Sent before it is stored: a code the customer never received must not
    // become the one the panel will accept.
    try {
      await sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    } catch (err: any) {
      // The provider's own reason is the only useful thing here — a verified
      // sender missing in Brevo, a rejected key. Swallowing it would leave the
      // office pressing a button that never explains itself.
      logger.error('Delivery OTP could not be sent', {
        orderId, orderNumber: order.orderNumber, error: err?.message,
      });
      throw new AppError(`The code could not be sent: ${err?.message ?? 'email failed'}`, 502);
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryOtpHash:      this.hash(orderId, code),
        deliveryOtpExpiresAt: expiresAt,
        deliveryOtpSentAt:    now,
        deliveryOtpSentCount: { increment: 1 },
        deliveryOtpAttempts:  0,
        deliveryOtpChannel:   'EMAIL',
      },
      select: { deliveryOtpSentCount: true },
    });

    logger.info('Delivery OTP sent', { orderId, orderNumber: order.orderNumber });

    return {
      channel:           'EMAIL',
      sentTo:            this.maskEmail(email),
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_S * 1000),
      sendsRemaining:    Math.max(0, MAX_SENDS - updated.deliveryOtpSentCount),
    };
  }

  /**
   * The office types in what the customer read out. A correct code is the
   * order's delivery receipt, so this is also what marks it DELIVERED — the
   * two facts must never be able to disagree.
   */
  async verify(orderId: string, submitted: string, adminUserId: string, codCollected?: number | null) {
    const order = await this.loadOrder(orderId);

    if (order.deliveryOtpVerifiedAt) {
      throw new AppError('This order has already been confirmed with a delivery code.', 400);
    }
    if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt) {
      throw new AppError('No delivery code has been sent for this order yet.', 400);
    }
    if (order.deliveryOtpExpiresAt.getTime() < Date.now()) {
      throw new AppError('That code has expired. Send a new one.', 400);
    }
    if (order.deliveryOtpAttempts >= MAX_ATTEMPTS) {
      throw new AppError('Too many wrong codes. Send a new one.', 429);
    }

    const code = String(submitted ?? '').replace(/\D/g, '');
    if (code.length !== OTP_LENGTH) {
      throw new AppError(`Enter the ${OTP_LENGTH}-digit code the customer read out.`, 400);
    }

    if (!this.matches(orderId, code, order.deliveryOtpHash)) {
      const { deliveryOtpAttempts } = await prisma.order.update({
        where: { id: orderId },
        data: { deliveryOtpAttempts: { increment: 1 } },
        select: { deliveryOtpAttempts: true },
      });
      const left = Math.max(0, MAX_ATTEMPTS - deliveryOtpAttempts);
      logger.warn('Delivery OTP rejected', { orderId, attemptsLeft: left });
      throw new AppError(
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and there are no tries left. Send a new one.',
        400,
      );
    }

    const now = new Date();
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status:                'DELIVERED',
        deliveryDate:          now,
        deliveryOtpVerifiedAt: now,
        deliveryOtpVerifiedBy: adminUserId,
        // The code is spent. Keeping the hash would let it be replayed.
        deliveryOtpHash:      null,
        deliveryOtpExpiresAt: null,
        deliveryOtpAttempts:  0,
        ...(codCollected != null && { codCollected }),
      },
    });

    logger.info('Delivery confirmed by OTP', {
      orderId, orderNumber: order.orderNumber, by: adminUserId,
    });
    const { deliveryOtpHash, ...safe } = updated;
    return safe;
  }

  /** What the panel needs to draw the card, with nothing sensitive in it. */
  async status(orderId: string) {
    const order = await this.loadOrder(orderId);
    const now = Date.now();
    const live = Boolean(
      order.deliveryOtpHash &&
      order.deliveryOtpExpiresAt &&
      order.deliveryOtpExpiresAt.getTime() > now,
    );

    let sentTo: string | null = null;
    const email = String(order.user?.email ?? '').trim();
    if (email) sentTo = this.maskEmail(email);

    return {
      eligible:  order.fulfilmentType === 'SELF' && SENDABLE_STATUSES.includes(order.status),
      verifiedAt: order.deliveryOtpVerifiedAt,
      channel:   order.deliveryOtpChannel,
      sentTo,
      hasEmail:  Boolean(email),
      mailConfigured: isMailConfigured(),
      codeLive:  live,
      expiresAt: live ? order.deliveryOtpExpiresAt : null,
      resendAvailableAt: order.deliveryOtpSentAt
        ? new Date(order.deliveryOtpSentAt.getTime() + RESEND_COOLDOWN_S * 1000)
        : null,
      sendsRemaining: Math.max(0, MAX_SENDS - order.deliveryOtpSentCount),
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - order.deliveryOtpAttempts),
      otpLength: OTP_LENGTH,
    };
  }
}

export const deliveryOtpService = new DeliveryOtpService();
