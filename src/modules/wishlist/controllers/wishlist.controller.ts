import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';

export class WishlistController {
  async getWishlist(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const items = await prisma.wishlistItem.findMany({
      where: { userId: req.user.userId },
      include: {
        product: {
          include: {
            images: { where: { isPrimary: true }, take: 1 },
            variants: { where: { isActive: true }, select: { size: true, color: true, stockQuantity: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, items, 'Wishlist fetched');
  }

  async toggle(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { productId } = req.body;

    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: req.user.userId, productId } },
    });

    if (existing) {
      await prisma.wishlistItem.delete({ where: { id: existing.id } });
      return sendSuccess(res, { inWishlist: false }, 'Removed from wishlist');
    } else {
      await prisma.wishlistItem.create({ data: { userId: req.user.userId, productId } });
      return sendSuccess(res, { inWishlist: true }, 'Added to wishlist');
    }
  }

  async check(req: Request, res: Response) {
    if (!req.user) return sendSuccess(res, { inWishlist: false }, '');
    const { productId } = req.params;
    const item = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: req.user.userId, productId } },
    });
    return sendSuccess(res, { inWishlist: !!item }, '');
  }
}

export const wishlistController = new WishlistController();
