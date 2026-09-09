import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError, sendPaginated } from '../../../utils/response';
import { createSlug } from '../../../utils/slugify';
import { getImageUrl } from '../../../utils/upload';
import { paginationParams } from '../../../utils/slugify';

export class BlogController {
  async getPublished(req: Request, res: Response) {
    const { page, limit, category } = req.query as Record<string, string>;
    const { skip } = paginationParams(page, limit);
    const where: any = { isPublished: true, deletedAt: null };
    if (category) where.blogCategory = { slug: category };

    const [blogs, total] = await Promise.all([
      prisma.blog.findMany({
        where,
        include: { blogCategory: true, tags: true },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: parseInt(limit || '10'),
      }),
      prisma.blog.count({ where }),
    ]);

    return sendPaginated(res, blogs, total, parseInt(page || '1'), parseInt(limit || '10'));
  }

  async getBySlug(req: Request, res: Response) {
    const { slug } = req.params;
    const blog = await prisma.blog.findFirst({
      where: { slug, isPublished: true, deletedAt: null },
      include: { blogCategory: true, tags: true },
    });
    if (!blog) return sendError(res, 'Blog not found', 404);
    await prisma.blog.update({ where: { id: blog.id }, data: { viewCount: { increment: 1 } } });
    return sendSuccess(res, blog, 'Blog fetched');
  }

  async create(req: Request, res: Response) {
    const file = req.file;
    const data = req.body;
    if (!data.slug) data.slug = createSlug(data.title);
    if (file) data.image = getImageUrl(file.path);
    if (data.isPublished && !data.publishedAt) data.publishedAt = new Date();

    const { tags, ...blogData } = data;
    const blog = await prisma.blog.create({
      data: {
        ...blogData,
        tags: tags?.length ? { create: tags.map((tag: string) => ({ tag })) } : undefined,
      },
      include: { tags: true },
    });
    return sendSuccess(res, blog, 'Blog created', 201);
  }

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const file = req.file;
    const data = req.body;
    if (file) data.image = getImageUrl(file.path);
    if (data.isPublished && !data.publishedAt) data.publishedAt = new Date();

    const { tags, ...blogData } = data;
    const blog = await prisma.blog.update({
      where: { id },
      data: {
        ...blogData,
        ...(tags && {
          tags: {
            deleteMany: {},
            create: tags.map((tag: string) => ({ tag })),
          },
        }),
      },
      include: { tags: true },
    });
    return sendSuccess(res, blog, 'Blog updated');
  }

  async delete(req: Request, res: Response) {
    const { id } = req.params;
    await prisma.blog.update({ where: { id }, data: { deletedAt: new Date() } });
    return sendSuccess(res, null, 'Blog deleted');
  }

  async getAllAdmin(req: Request, res: Response) {
    const { page, limit } = req.query as Record<string, string>;
    const { skip } = paginationParams(page, limit);

    const [blogs, total] = await Promise.all([
      prisma.blog.findMany({
        where: { deletedAt: null },
        include: { blogCategory: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit || '20'),
      }),
      prisma.blog.count({ where: { deletedAt: null } }),
    ]);
    return sendPaginated(res, blogs, total, parseInt(page || '1'), parseInt(limit || '20'));
  }

  async getCategories(req: Request, res: Response) {
    const categories = await prisma.blogCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { blogs: { where: { isPublished: true } } } } },
    });
    return sendSuccess(res, categories, 'Blog categories');
  }
}

export const blogController = new BlogController();
