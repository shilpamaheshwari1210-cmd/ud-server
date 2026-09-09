import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { getImageUrl } from '../../../utils/upload';
import { paginationParams } from '../../../utils/slugify';

export class UserController {
  async updateProfile(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { firstName, lastName, phone } = req.body;
    const file = req.file;

    const data: any = { firstName, lastName, phone };
    if (file) data.avatar = getImageUrl(file.path);

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true, role: true },
    });

    return sendSuccess(res, user, 'Profile updated');
  }

  // Addresses
  async getAddresses(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const addresses = await prisma.address.findMany({ where: { userId: req.user.userId } });
    return sendSuccess(res, addresses, 'Addresses fetched');
  }

  async addAddress(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const data = { ...req.body, userId: req.user.userId };

    if (data.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user.userId }, data: { isDefault: false } });
    }

    const address = await prisma.address.create({ data });
    return sendSuccess(res, address, 'Address added', 201);
  }

  async updateAddress(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { id } = req.params;

    if (req.body.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user.userId }, data: { isDefault: false } });
    }

    const address = await prisma.address.update({
      where: { id, userId: req.user.userId },
      data: req.body,
    });
    return sendSuccess(res, address, 'Address updated');
  }

  async deleteAddress(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { id } = req.params;
    await prisma.address.delete({ where: { id, userId: req.user.userId } });
    return sendSuccess(res, null, 'Address deleted');
  }

  // Recently viewed
  async getRecentlyViewed(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const items = await prisma.recentlyViewed.findMany({
      where: { userId: req.user.userId },
      include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } } },
      orderBy: { viewedAt: 'desc' },
      take: 20,
    });
    return sendSuccess(res, items, 'Recently viewed');
  }

  async addRecentlyViewed(req: Request, res: Response) {
    if (!req.user) return sendSuccess(res, null, '');
    const { productId } = req.body;
    await prisma.recentlyViewed.upsert({
      where: { userId_productId: { userId: req.user.userId, productId } },
      create: { userId: req.user.userId, productId },
      update: { viewedAt: new Date() },
    });
    return sendSuccess(res, null, '');
  }

  // Notifications
  async getNotifications(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return sendSuccess(res, notifications, 'Notifications fetched');
  }

  async markNotificationsRead(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return sendSuccess(res, null, 'Marked as read');
  }

  // Admin
  async getAllUsers(req: Request, res: Response) {
    const { page, limit, search, role } = req.query as Record<string, string>;
    const { skip } = paginationParams(page, limit);
    const where: any = { deletedAt: null };
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, isActive: true, avatar: true, createdAt: true, lastLoginAt: true, _count: { select: { orders: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit || '20'),
      }),
      prisma.user.count({ where }),
    ]);

    return sendPaginated(res, users, total, parseInt(page || '1'), parseInt(limit || '20'));
  }

  async updateUser(req: Request, res: Response) {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return sendError(res, 'User not found', 404);
    const { password, role, ...allowed } = req.body;
    const updated = await prisma.user.update({ where: { id }, data: allowed });
    return sendSuccess(res, updated, 'User updated');
  }

  async toggleUserStatus(req: Request, res: Response) {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return sendError(res, 'User not found', 404);

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
    });
    return sendSuccess(res, updated, `User ${updated.isActive ? 'activated' : 'deactivated'}`);
  }
}

export const userController = new UserController();
