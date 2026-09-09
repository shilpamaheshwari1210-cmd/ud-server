import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config/env';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /** Machine-readable reason, when the client has to branch on it. */
  code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (code) this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
};

/**
 * Fields that must never reach the log file.
 *
 * The handler logs the request body to make failures diagnosable, which meant
 * every failed login wrote the submitted password into logs/error.log in clear
 * text — and log files get copied around, shipped to support, and kept far
 * longer than anyone intends. Failed sign-ins are now the most common error
 * this handler sees, so the body is redacted before it is written.
 */
const SENSITIVE_FIELDS = [
  'password', 'newPassword', 'currentPassword', 'confirmPassword',
  'token', 'refreshToken', 'accessToken', 'otp', 'apiKey', 'secret',
];

const redact = (body: unknown): unknown => {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
      clone[key] = '[redacted]';
    }
  }
  return clone;
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = 'statusCode' in err ? err.statusCode : 500;
  const message = err.message || 'Internal Server Error';

  logger.error(`${req.method} ${req.path} - ${statusCode} - ${message}`, {
    stack: err.stack,
    body: redact(req.body),
    params: req.params,
  });

  // Some failures carry a machine-readable reason the client must act on —
  // an unverified sign-in has to send the customer to the code screen rather
  // than just showing them the message.
  const code = (err as any).code;
  const email = (err as any).email;

  res.status(statusCode).json({
    success: false,
    message,
    ...(typeof code === 'string' && { code }),
    ...(typeof email === 'string' && { email }),
    ...(config.isDev && { stack: err.stack }),
  });
};
