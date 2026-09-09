import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess, sendError } from '../../../utils/response';
import { AppError } from '../../../middlewares/error.middleware';

export class CartController {
  private async getOrCreateCart(userId?: string, sessionId?: string) {
    if (!userId && !sessionId) throw new AppError('Cart identifier required', 400);

    const where = userId ? { userId } : { sessionId };
    let cart = await prisma.cart.findFirst({ where, include: { items: { include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } }, variant: true } } } });

    if (!cart) {
      cart = await prisma.cart.create({
        data: userId ? { userId } : { sessionId },
        include: { items: { include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } }, variant: true } } },
      });
    }

    return cart;
  }

  async getCart(req: Request, res: Response) {
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;
    const cart = await this.getOrCreateCart(userId, sessionId);
    return sendSuccess(res, cart, 'Cart fetched');
  }

  async addItem(req: Request, res: Response) {
    const { productId, variantId, quantity = 1 } = req.body;
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    const product = await prisma.product.findFirst({
      where: { id: productId, isActive: true, deletedAt: null },
    });
    if (!product) return sendError(res, 'Product not found', 404);

    let price = Number(variantId ? (await prisma.productVariant.findUnique({ where: { id: variantId } }))?.price || product.salePrice || product.basePrice : product.salePrice || product.basePrice);

    const cart = await this.getOrCreateCart(userId, sessionId);

    const existingItem = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, variantId: variantId || null },
    });

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId, variantId: variantId || null, quantity, price },
      });
    }

    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } }, variant: true } } },
    });

    return sendSuccess(res, updatedCart, 'Item added to cart');
  }

  async updateItem(req: Request, res: Response) {
    const { itemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    const cartWhere = userId ? { userId } : { sessionId };
    const cart = await prisma.cart.findFirst({ where: cartWhere });
    if (!cart) return sendError(res, 'Cart not found', 404);

    const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
    if (!item) return sendError(res, 'Cart item not found', 404);

    if (quantity < 1) {
      await prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }

    return sendSuccess(res, null, 'Cart updated');
  }

  async removeItem(req: Request, res: Response) {
    const { itemId } = req.params;
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;

    const cartWhere = userId ? { userId } : { sessionId };
    const cart = await prisma.cart.findFirst({ where: cartWhere });
    if (!cart) return sendError(res, 'Cart not found', 404);

    const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
    if (!item) return sendError(res, 'Cart item not found', 404);

    await prisma.cartItem.delete({ where: { id: itemId } });
    return sendSuccess(res, null, 'Item removed');
  }

  async clearCart(req: Request, res: Response) {
    const userId = req.user?.userId;
    const sessionId = req.headers['x-session-id'] as string;
    const where = userId ? { userId } : { sessionId };
    const cart = await prisma.cart.findFirst({ where });
    if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return sendSuccess(res, null, 'Cart cleared');
  }

  async applyCoupon(req: Request, res: Response) {
    const { code, cartTotal } = req.body;
    const now = new Date();
    const coupon = await prisma.coupon.findFirst({
      where: {
        code: { equals: code },
        isActive: true,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        ],
      },
    });

    if (!coupon) return sendError(res, 'Invalid or expired coupon', 400);

    if (coupon.minOrderAmount && cartTotal < Number(coupon.minOrderAmount)) {
      return sendError(res, `Minimum order amount is ₹${coupon.minOrderAmount}`, 400);
    }

    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return sendError(res, 'Coupon usage limit reached', 400);
    }

    let discount = 0;
    let freeShipping = false;
    if (coupon.type === 'PERCENTAGE') {
      discount = (cartTotal * Number(coupon.value)) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, Number(coupon.maxDiscount));
    } else if (coupon.type === 'FIXED') {
      discount = Math.min(Number(coupon.value), cartTotal);
    } else if (coupon.type === 'FREE_SHIPPING') {
      // Nothing comes off the goods — the delivery charge is waived instead,
      // and the caller has to be told so, or the preview shows "₹0 off" for a
      // coupon that is genuinely worth something.
      discount = 0;
      freeShipping = true;
    }

    return sendSuccess(
      res,
      {
        coupon: { code: coupon.code, type: coupon.type, discount },
        discountAmount: discount,
        freeShipping,
      },
      freeShipping ? 'Free delivery applied' : 'Coupon applied',
    );
  }
}

export const cartController = new CartController();
