import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt';
import { sendError } from '../utils/response';
import { prisma } from '../config/prisma';
import { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & { dbRole?: UserRole };
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(res, 'No token provided', 401);
    }
    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId, isActive: true, deletedAt: null },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user) return sendError(res, 'User not found or inactive', 401);

    req.user = { ...payload, dbRole: user.role };
    return next();
  } catch {
    return sendError(res, 'Invalid or expired token', 401);
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    if (!roles.includes(req.user.dbRole as UserRole)) {
      return sendError(res, 'Forbidden: insufficient permissions', 403);
    }
    return next();
  };
};

export const isAdmin = authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN);
export const isAdminOrSubAdmin = authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN);
export const isSuperAdmin = authorize(UserRole.SUPER_ADMIN);
