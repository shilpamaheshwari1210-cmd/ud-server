import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { paginationParams } from '../../../utils/slugify';

export class ReviewController {
  async getProductReviews(req: Request, res: Response) {
    const { productId } = req.params;
    const { page, limit } = req.query as Record<string, string>;
    const { skip } = paginationParams(page, limit);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { productId, isApproved: true },
        include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit || '10'),
      }),
      prisma.review.count({ where: { productId, isApproved: true } }),
    ]);

    return sendPaginated(res, reviews, total, parseInt(page || '1'), parseInt(limit || '10'));
  }

  async createReview(req: Request, res: Response) {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    const { productId, rating, title, body } = req.body;

    const existing = await prisma.review.findFirst({
      where: { productId, userId: req.user.userId },
    });
    if (existing) return sendError(res, 'You have already reviewed this product', 409);

    const review = await prisma.review.create({
      data: { productId, userId: req.user.userId, rating, title, body },
    });

    const stats = await prisma.review.aggregate({
      where: { productId, isApproved: true },
      _avg: { rating: true },
      _count: true,
    });

    await prisma.product.update({
      where: { id: productId },
      data: {
        avgRating: stats._avg.rating || 0,
        totalReviews: stats._count,
      },
    });

    return sendSuccess(res, review, 'Review submitted', 201);
  }

  async getAllReviews(req: Request, res: Response) {
    const { page, limit, status } = req.query as Record<string, string>;
    const { skip } = paginationParams(page, limit);
    const where: any = {};
    if (status) where.status = status;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          product: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit || '20'),
      }),
      prisma.review.count({ where }),
    ]);

    return sendPaginated(res, reviews, total, parseInt(page || '1'), parseInt(limit || '20'));
  }

  async updateReview(req: Request, res: Response) {
    const { id } = req.params;
    const { isApproved, status, ...rest } = req.body;
    const data: any = { ...rest };
    if (isApproved !== undefined) data.isApproved = isApproved;
    if (status !== undefined) data.status = status;

    const review = await prisma.review.update({ where: { id }, data });

    if (isApproved !== undefined) {
      const stats = await prisma.review.aggregate({
        where: { productId: review.productId, isApproved: true },
        _avg: { rating: true },
        _count: true,
      });
      await prisma.product.update({
        where: { id: review.productId },
        data: { avgRating: stats._avg.rating || 0, totalReviews: stats._count },
      });
    }

    return sendSuccess(res, review, 'Review updated');
  }

  async deleteReview(req: Request, res: Response) {
    const { id } = req.params;
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) return sendError(res, 'Review not found', 404);
    await prisma.review.delete({ where: { id } });

    const stats = await prisma.review.aggregate({
      where: { productId: review.productId, isApproved: true },
      _avg: { rating: true },
      _count: true,
    });
    await prisma.product.update({
      where: { id: review.productId },
      data: { avgRating: stats._avg.rating || 0, totalReviews: stats._count },
    });

    return sendSuccess(res, null, 'Review deleted');
  }

  async updateReviewStatus(req: Request, res: Response) {
    const { id } = req.params;
    const { status, isApproved } = req.body;

    const review = await prisma.review.update({
      where: { id },
      data: { status, isApproved },
    });

    if (isApproved !== undefined) {
      const stats = await prisma.review.aggregate({
        where: { productId: review.productId, isApproved: true },
        _avg: { rating: true },
        _count: true,
      });
      await prisma.product.update({
        where: { id: review.productId },
        data: { avgRating: stats._avg.rating || 0, totalReviews: stats._count },
      });
    }

    return sendSuccess(res, review, 'Review updated');
  }
}

export const reviewController = new ReviewController();
