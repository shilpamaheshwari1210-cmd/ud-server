import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../../config/prisma';
import { config } from '../../../config/env';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../../utils/jwt';
import { AppError } from '../../../middlewares/error.middleware';
import { UserRole } from '@prisma/client';
import { generateOtp, hashOtp, otpMatches } from '../../../utils/otp';
import { sendMail, isMailConfigured } from '../../../config/mailer';
import { signInCodeEmail } from '../../../emails/signInCode.template';
import { logger } from '../../../utils/logger';

const googleClient = new OAuth2Client(config.google.clientId);

export class AuthService {
  // ─── Passwordless sign-in ─────────────────────────────────────────────

  private static readonly OTP_TTL_MINUTES = 10;
  private static readonly OTP_RESEND_COOLDOWN_S = 45;
  private static readonly OTP_MAX_SENDS = 6;
  private static readonly OTP_MAX_ATTEMPTS = 5;

  /**
   * Send a sign-in code. Creates NO user row.
   *
   * The pending code lives in EmailOtp, so an abandoned sign-up leaves nothing
   * behind. Previously the account was created first and the code hung off it,
   * which meant walking away from the code screen locked that address out of
   * both registering again and signing in.
   */
  async requestOtp(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }) {
    const email = data.email.trim().toLowerCase();

    if (!isMailConfigured()) {
      throw new AppError('Email is not set up on this server, so codes cannot be sent.', 503);
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, firstName: true, isActive: true },
    });
    if (existing && !existing.isActive) {
      throw new AppError('Account disabled. Contact support.', 403);
    }

    const isNewUser = !existing;
    // A new address needs a name; there is nowhere else to get one, and an
    // account with a blank name looks broken everywhere it appears.
    if (isNewUser && !String(data.firstName ?? '').trim()) {
      throw new AppError('Please tell us your name to create your account.', 400, 'NAME_REQUIRED');
    }

    const pending = await prisma.emailOtp.findUnique({ where: { email } });
    const now = new Date();

    if (pending?.lastSentAt) {
      const waited = now.getTime() - pending.lastSentAt.getTime();
      if (waited < AuthService.OTP_RESEND_COOLDOWN_S * 1000) {
        const seconds = Math.ceil((AuthService.OTP_RESEND_COOLDOWN_S * 1000 - waited) / 1000);
        throw new AppError(`A code was just sent. Try again in ${seconds}s.`, 429);
      }
    }
    if (pending && pending.sentCount >= AuthService.OTP_MAX_SENDS) {
      throw new AppError('Too many codes requested for this email. Try again later.', 429);
    }

    const code = generateOtp(6);
    const expiresAt = new Date(now.getTime() + AuthService.OTP_TTL_MINUTES * 60_000);

    const mail = signInCodeEmail({
      firstName: existing?.firstName ?? data.firstName ?? null,
      otp: code,
      minutesValid: AuthService.OTP_TTL_MINUTES,
      isNewUser,
    });

    // Sent before it is stored: a code that never left must not become the one
    // the server will accept.
    await sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });

    const payload = {
      otpHash: hashOtp(email, code),
      expiresAt,
      lastSentAt: now,
      attempts: 0,
      firstName: data.firstName?.trim() || null,
      lastName: data.lastName?.trim() || null,
      phone: data.phone?.trim() || null,
    };

    await prisma.emailOtp.upsert({
      where: { email },
      create: { email, ...payload, sentCount: 1 },
      update: { ...payload, sentCount: { increment: 1 } },
    });

    logger.info('Sign-in code sent', { email, isNewUser });
    return {
      isNewUser,
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + AuthService.OTP_RESEND_COOLDOWN_S * 1000),
    };
  }

  /**
   * Verify the code. This is what signs a customer in, and — for a new address
   * — what creates the account. The row is written only once the code is right.
   */
  async verifyOtp(rawEmail: string, submitted: string) {
    const email = rawEmail.trim().toLowerCase();
    const pending = await prisma.emailOtp.findUnique({ where: { email } });

    if (!pending) throw new AppError('No code was requested for this email. Request a new one.', 400);
    if (pending.expiresAt.getTime() < Date.now()) {
      throw new AppError('That code has expired. Request a new one.', 400);
    }
    if (pending.attempts >= AuthService.OTP_MAX_ATTEMPTS) {
      throw new AppError('Too many incorrect codes. Request a new one.', 429);
    }

    const code = String(submitted ?? '').replace(/\D/g, '');
    if (code.length !== 6) throw new AppError('Enter the 6-digit code from your email.', 400);

    if (!otpMatches(email, code, pending.otpHash)) {
      const { attempts } = await prisma.emailOtp.update({
        where: { email },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = Math.max(0, AuthService.OTP_MAX_ATTEMPTS - attempts);
      throw new AppError(
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and there are no tries left. Request a new one.',
        400,
      );
    }

    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    if (user && !user.isActive) throw new AppError('Account disabled. Contact support.', 403);

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          firstName: pending.firstName || 'Customer',
          lastName: pending.lastName || '',
          phone: pending.phone,
          // Proven by the code that was just entered.
          isVerified: true,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
      });
      logger.info('Account created by sign-in code', { userId: user.id });
    }

    const account = {
      id: user.id, email: user.email, firstName: user.firstName,
      lastName: user.lastName, role: user.role,
    };
    const tokens = this.generateTokens(account);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          refreshToken: tokens.refreshToken,
          lastLoginAt: new Date(),
          // Signing in by code proves the address, whatever the row said before.
          isVerified: true,
          emailVerifiedAt: new Date(),
        },
      }),
      // Spent. Leaving it would let the same code be replayed.
      prisma.emailOtp.delete({ where: { email } }),
    ]);

    return { user: account, ...tokens };
  }

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        password: true, isActive: true, isVerified: true,
      },
    });

    if (!user || !user.password) throw new AppError('Invalid credentials', 401);
    if (!user.isActive) throw new AppError('Account disabled. Contact support.', 403);

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) throw new AppError('Invalid credentials', 401);

    // Checked only after the password, so this never reveals whether an
    // address has an account to someone who cannot already sign in.
    if (!user.isVerified) {
      const err = new AppError('Please verify your email to continue.', 403);
      (err as any).code = 'EMAIL_NOT_VERIFIED';
      (err as any).email = user.email;
      throw err;
    }

    const tokens = this.generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken, lastLoginAt: new Date() },
    });

    const { password: _, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, ...tokens };
  }

  async googleLogin(token: string) {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: config.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new AppError('Invalid Google token', 400);

    let user = await prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: payload.email,
          firstName: payload.given_name || '',
          lastName: payload.family_name || '',
          googleId: payload.sub,
          avatar: payload.picture,
          isVerified: true,
          role: UserRole.CUSTOMER,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: payload.sub, avatar: payload.picture || user.avatar },
      });
    }

    if (!user.isActive) throw new AppError('Account disabled', 403);

    const tokens = this.generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken, lastLoginAt: new Date() },
    });

    return { user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, ...tokens };
  }

  async refreshTokens(token: string) {
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new AppError('Invalid refresh token', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, refreshToken: true, isActive: true },
    });

    if (!user || !user.isActive || user.refreshToken !== token) {
      throw new AppError('Invalid refresh token', 401);
    }

    const tokens = this.generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return tokens;
  }

  async logout(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3600000);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });

    return { token, email: user.email, name: user.firstName };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) throw new AppError('Invalid or expired reset token', 400);

    const hashedPassword = await bcrypt.hash(newPassword, config.bcryptRounds);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiry: null,
        refreshToken: null,
      },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user?.password) throw new AppError('Password not set', 400);

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new AppError('Current password is incorrect', 400);

    const hashed = await bcrypt.hash(newPassword, config.bcryptRounds);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed, refreshToken: null },
    });
  }

  private generateTokens(user: { id: string; email: string; role: UserRole }) {
    const payload = { userId: user.id, email: user.email, role: user.role };
    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
    };
  }
}

export const authService = new AuthService();
