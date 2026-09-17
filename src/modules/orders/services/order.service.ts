import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middlewares/error.middleware';
import { generateOrderNumber } from '../../../utils/slugify';
import { paginationParams } from '../../../utils/slugify';
import { logger } from '../../../utils/logger';
import { resolveCountryByCode, getCountryPricingMap, resolveCountryShipping } from '../../../utils/countryPricing';

export class OrderService {
  private static readonly SHIPPING_RATES: Record<string, number> = {
    STANDARD: 79,
    COD:      149,
    EXPRESS:  249,
  };

  /**
   * The address stored on the order is a snapshot: the customer may edit or
   * delete the saved address later, and the order must still show where it
   * actually went. When a saved address is chosen the browser sends nothing
   * useful, so the snapshot is built here from the row itself.
   */
  private async resolveShippingAddress(
    tx: Prisma.TransactionClient,
    userId: string,
    addressId: string | undefined,
    posted: any,
  ) {
    if (addressId) {
      const saved = await tx.address.findFirst({ where: { id: addressId, userId } });
      if (!saved) throw new AppError('Address not found', 400);
      return {
        firstName:    saved.firstName,
        lastName:     saved.lastName,
        phone:        saved.phone,
        addressLine1: saved.addressLine1,
        addressLine2: saved.addressLine2 ?? '',
        city:         saved.city,
        state:        saved.state,
        pincode:      saved.pincode,
        country:      saved.country,
      };
    }

    const a = posted ?? {};
    const required = ['firstName', 'phone', 'addressLine1', 'city', 'state', 'pincode'];
    const missing = required.filter(f => !String(a[f] ?? '').trim());
    if (missing.length) {
      throw new AppError(`Delivery address is incomplete: ${missing.join(', ')}`, 400);
    }
    return {
      firstName:    String(a.firstName).trim(),
      lastName:     String(a.lastName ?? '').trim(),
      phone:        String(a.phone).trim(),
      addressLine1: String(a.addressLine1).trim(),
      addressLine2: String(a.addressLine2 ?? '').trim(),
      city:         String(a.city).trim(),
      state:        String(a.state).trim(),
      pincode:      String(a.pincode).trim(),
      country:      String(a.country ?? 'India').trim(),
    };
  }

  /**
   * Which pincodes we deliver ourselves. Stored as a setting rather than in
   * code because the answer changes with hiring, not with releases: the shop
   * adds a nearby town the week it has someone to ride there.
   *
   * Entries are matched as prefixes, so "3020" covers every pincode in that
   * block and "302017" covers exactly one.
   */
  private async selfDeliveryPincodes(tx: Prisma.TransactionClient): Promise<string[]> {
    const row = await tx.setting.findUnique({ where: { key: 'self_delivery_pincodes' } });
    return (row?.value ?? '')
      .split(/[,\n]/)
      .map(p => p.replace(/\D/g, ''))
      .filter(Boolean);
  }

  private async defaultFulfilment(
    tx: Prisma.TransactionClient,
    pincode: string,
  ): Promise<'SELF' | 'DELHIVERY'> {
    const clean = String(pincode ?? '').replace(/\D/g, '');
    if (!clean) return 'DELHIVERY';
    const prefixes = await this.selfDeliveryPincodes(tx);
    return prefixes.some(p => clean.startsWith(p)) ? 'SELF' : 'DELHIVERY';
  }

  async createOrder(userId: string, data: {
    addressId?: string;
    paymentMethod: string;
    shippingMethod?: string;
    couponCode?: string;
    notes?: string;
    // `price` is accepted for backwards compatibility with the current
    // request shape but is NEVER used to compute money — see effectivePrice()
    // below, which re-derives it from the database on every order.
    items: { productId: string; variantId?: string; quantity: number; price?: number }[];
    shippingAddress: object;
    billingAddress?: object;
    // ISO 3166-1 alpha-2 country code. Same server-authoritative rule as
    // price: this selects WHICH DB-derived price to charge, it never carries
    // a price value itself. An unknown code is a real error here (unlike the
    // product browse endpoints) — real money is about to move.
    country?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      // 0. Resolve the country, if one was sent, before anything else — an
      // unknown code should fail the order up front, not half way through.
      const country = data.country ? await resolveCountryByCode(tx, data.country) : null;

      // 1. Fetch products and validate stock before touching any data
      const productIds = [...new Set(data.items.map(i => i.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true, deletedAt: null },
        select: {
          id: true, name: true, stockQuantity: true,
          basePrice: true, salePrice: true,
          standardShippingCharge: true,
          codShippingCharge: true,
          expressShippingCharge: true,
          images: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      });
      const productMap = new Map(products.map(p => [p.id, p]));

      // Order lines record the size, colour and SKU as they were at purchase.
      // Reading them back through the variant relation is not enough: a variant
      // can be renamed or deleted, and the warehouse still has to know which
      // size to pack.
      const variantIds = [...new Set(data.items.map(i => i.variantId).filter(Boolean))] as string[];
      const variants = variantIds.length
        ? await tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, size: true, color: true, sku: true, image: true, price: true },
          })
        : [];
      const variantMap = new Map(variants.map(v => [v.id, v]));

      for (const item of data.items) {
        const product = productMap.get(item.productId);
        if (!product) throw new AppError(`Product not found: ${item.productId}`, 400);
        if (product.stockQuantity < item.quantity) {
          throw new AppError(`Insufficient stock for "${product.name}"`, 400);
        }
      }

      // Country-specific price overrides, if a country was resolved above.
      // Same DB-derived-only rule as everything else here — this is only ever
      // looked up by (product, country), never taken from the request body.
      const countryPricingMap = country
        ? await getCountryPricingMap(tx, country.id, productIds)
        : new Map<string, { basePrice: Prisma.Decimal; salePrice: Prisma.Decimal | null }>();

      // 2. Compute totals — price is ALWAYS re-derived from the database here,
      // never taken from data.items[].price. That field arrives from the
      // browser and a crafted request could set it to anything; trusting it
      // would let a customer name their own price. Same effective-price rule
      // cart.controller.ts uses, so what the cart showed is what gets charged:
      // variant.price if the line has a variant and it has one set, else a
      // ProductCountryPricing override for the resolved country if one
      // exists, else the product's salePrice, else its basePrice.
      const effectivePrice = (productId: string, variantId?: string): number => {
        const product = productMap.get(productId)!;
        const variant = variantId ? variantMap.get(variantId) : undefined;
        if (variant?.price != null) return Number(variant.price);
        const countryOverride = countryPricingMap.get(productId);
        if (countryOverride) return Number(countryOverride.salePrice ?? countryOverride.basePrice);
        return Number(product.salePrice ?? product.basePrice);
      };
      const subtotal = data.items.reduce(
        (sum, item) => sum + effectivePrice(item.productId, item.variantId) * item.quantity,
        0,
      );
      const method = (data.shippingMethod || 'STANDARD').toUpperCase();

      // Use per-product charge if set (take the max across all cart items),
      // otherwise fall back to the global rate for the chosen method.
      const fieldMap: Record<string, 'standardShippingCharge' | 'codShippingCharge' | 'expressShippingCharge'> = {
        STANDARD: 'standardShippingCharge',
        COD:      'codShippingCharge',
        EXPRESS:  'expressShippingCharge',
      };
      const chargeField = fieldMap[method];
      let shippingCharge = OrderService.SHIPPING_RATES[method] ?? 79;
      if (chargeField) {
        const productCharges = data.items
          .map(item => {
            const p = productMap.get(item.productId);
            return p ? Number((p as any)[chargeField] ?? 0) : 0;
          })
          .filter(c => c > 0);
        if (productCharges.length > 0) {
          shippingCharge = Math.max(...productCharges);
        }
      }

      // Highest-priority step: a CountryShippingRule for (country, method)
      // overrides everything above — per-product override and the flat rate
      // both stay as the fallback chain for countries with no rule configured,
      // so India (and every other country until an admin sets one up) keeps
      // behaving exactly as it did before this existed.
      const countryShippingRule = country
        ? await resolveCountryShipping(tx, country.id, method, subtotal)
        : null;
      if (countryShippingRule) {
        shippingCharge = countryShippingRule.cost;
      }
      // Prices are GST-inclusive; taxAmount is stored for display/accounting only
      const taxAmount = subtotal * 0.18;
      let couponDiscount = 0;
      let couponApplied = false;
      let freeShipping = false;

      // 3. Validate and apply coupon inside the transaction
      if (data.couponCode) {
        const now = new Date();
        const coupon = await tx.coupon.findFirst({
          where: {
            code: data.couponCode,
            isActive: true,
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            ],
          },
        });

        if (coupon && (!coupon.usageLimit || coupon.usageCount < coupon.usageLimit)) {
          if (!coupon.minOrderAmount || subtotal >= Number(coupon.minOrderAmount)) {
            if (coupon.type === 'PERCENTAGE') {
              couponDiscount = (subtotal * Number(coupon.value)) / 100;
              if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, Number(coupon.maxDiscount));
            } else if (coupon.type === 'FIXED') {
              couponDiscount = Math.min(Number(coupon.value), subtotal);
            } else if (coupon.type === 'FREE_SHIPPING') {
              // Waives the delivery charge rather than discounting the goods.
              // Previously this branch did not exist, so a FREE_SHIPPING coupon
              // validated, reported a discount of zero, and changed nothing —
              // the customer was told it applied and still paid for delivery.
              freeShipping = true;
            }
            await tx.coupon.update({
              where: { id: coupon.id },
              data: { usageCount: { increment: 1 } },
            });
            couponApplied = true;
          }
        }

        if (!couponApplied) {
          // The order still goes through at full price — refusing it at the
          // final step would lose the sale over a coupon — but this must not
          // pass silently, or the only evidence is a customer who believed
          // they had a discount.
          logger.warn('Coupon requested but not applied', {
            code: data.couponCode, userId, subtotal,
          });
        }
      }

      if (freeShipping) shippingCharge = 0;

      const total = subtotal - couponDiscount + shippingCharge;

      const shippingAddress = await this.resolveShippingAddress(
        tx, userId, data.addressId, data.shippingAddress,
      );

      const fulfilmentType = await this.defaultFulfilment(tx, shippingAddress.pincode);

      // 4. Create order with populated item names
      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId,
          addressId: data.addressId,
          countryId: country?.id,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          paymentMethod: data.paymentMethod as any,
          shippingMethod: method,
          subtotal,
          discount: couponDiscount,
          shippingCharge,
          taxAmount,
          total,
          couponCode: data.couponCode,
          couponDiscount,
          notes: data.notes,
          fulfilmentType,
          shippingAddress,
          billingAddress: data.billingAddress || shippingAddress,
          items: {
            create: data.items.map(item => {
              const product = productMap.get(item.productId);
              const variant = item.variantId ? variantMap.get(item.variantId) : undefined;
              const price = effectivePrice(item.productId, item.variantId);
              return {
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
                price,
                total: price * item.quantity,
                name: product?.name ?? '',
                size:  variant?.size  ?? null,
                color: variant?.color ?? null,
                sku:   variant?.sku   ?? null,
                image: variant?.image || product?.images?.[0]?.url || null,
              };
            }),
          },
        },
        include: { items: true, address: true },
      });

      // 5. Atomically decrement stock within the same transaction, and log
      // every movement so InventoryLog has a full audit trail to match.
      for (const item of data.items) {
        const updatedProduct = await tx.product.update({
          where: { id: item.productId },
          data: {
            totalSold: { increment: item.quantity },
            stockQuantity: { decrement: item.quantity },
          },
          select: { stockQuantity: true },
        });
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            type: 'SALE',
            quantity: item.quantity,
            // The update above already applied the decrement atomically, so
            // the "before" value is derived from the "after" it returned
            // rather than re-read (which could race with a concurrent order).
            previousQty: updatedProduct.stockQuantity + item.quantity,
            newQty: updatedProduct.stockQuantity,
            reason: 'Order placed',
            reference: order.orderNumber,
          },
        });
      }

      return order;
    });
  }

  /**
   * The OTP hash is an internal credential, not order data. It is stripped on
   * the way out so it cannot appear in a customer payload, an admin payload,
   * or anything logged downstream from one.
   */
  private withoutOtpSecret<T extends Record<string, any>>(order: T): Omit<T, 'deliveryOtpHash'> {
    const { deliveryOtpHash, ...rest } = order;
    return rest;
  }

  async getOrderById(id: string, userId?: string) {
    const where = userId ? { id, userId } : { id };
    const order = await prisma.order.findFirst({
      where,
      include: {
        items: {
          include: {
            product: { include: { images: { where: { isPrimary: true }, take: 1 } } },
            variant: true,
          },
        },
        address: true,
        payment: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true } },
      },
    });

    if (!order) throw new AppError('Order not found', 404);
    return this.withoutOtpSecret(order);
  }

  async getOrderByNumber(orderNumber: string) {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: {
        items: { include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } }, variant: true } },
        address: true,
        payment: true,
      },
    });
    if (!order) throw new AppError('Order not found', 404);
    return this.withoutOtpSecret(order);
  }

  async getUserOrders(userId: string, page = 1, limit = 10) {
    const { skip, page: currentPage, limit: take } = paginationParams(page, limit);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: {
          items: { take: 2, include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } } } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.order.count({ where: { userId } }),
    ]);
    return { orders: orders.map(o => this.withoutOtpSecret(o)), total, page: currentPage, limit: take };
  }

  async getAllOrders(page = 1, limit = 20, filters?: {
    status?: string;
    paymentStatus?: string;
    fulfilmentType?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { skip, page: currentPage, limit: take } = paginationParams(page, limit);
    const where: any = {};

    if (filters?.status) where.status = filters.status;
    if (filters?.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters?.fulfilmentType) where.fulfilmentType = filters.fulfilmentType;
    if (filters?.search) {
      // Support staff are given a phone number far more often than an order
      // number, so the search covers every way a customer identifies themselves.
      where.OR = [
        { orderNumber: { contains: filters.search } },
        { user: { email:     { contains: filters.search } } },
        { user: { phone:     { contains: filters.search } } },
        { user: { firstName: { contains: filters.search } } },
        { user: { lastName:  { contains: filters.search } } },
        { address: { phone:   { contains: filters.search } } },
        { address: { pincode: { contains: filters.search } } },
      ];
    }
    if (filters?.startDate) where.createdAt = { gte: new Date(filters.startDate) };
    if (filters?.endDate) where.createdAt = { ...where.createdAt, lte: new Date(filters.endDate) };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          items: { take: 1, include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } } } },
          address: true,
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.order.count({ where }),
    ]);

    return { orders: orders.map(o => this.withoutOtpSecret(o)), total, page: currentPage, limit: take };
  }

  async updateOrderStatus(
    id: string,
    status: string,
    trackingNumber?: string,
    trackingUrl?: string,
    actor?: { role?: string; overrideReason?: string },
  ) {
    const existing = await prisma.order.findUnique({
      where: { id },
      select: {
        dispatchedAt: true,
        fulfilmentType: true,
        deliveryOtpVerifiedAt: true,
        deliveryNotes: true,
      },
    });
    if (!existing) throw new AppError('Order not found', 404);

    // On an order one of our own people is carrying, DELIVERED means the
    // customer read a code back to us. Without that this dropdown would be an
    // easier way to claim a delivery than actually making one.
    let overrideNote: string | null = null;
    if (
      status === 'DELIVERED' &&
      existing.fulfilmentType === 'SELF' &&
      !existing.deliveryOtpVerifiedAt
    ) {
      const isFullAdmin = actor?.role === 'ADMIN' || actor?.role === 'SUPER_ADMIN';
      const reason = String(actor?.overrideReason ?? '').trim();

      if (!isFullAdmin) {
        throw new AppError(
          'Confirm this delivery with the code from the customer. Use the Delivery Confirmation card above.',
          400,
        );
      }
      // The escape hatch for a customer with no email or a dead phone: an
      // admin may still close the order, but has to say why, on the record.
      if (reason.length < 5) {
        throw new AppError(
          'No delivery code was confirmed for this order. To mark it delivered anyway, give a reason.',
          400,
        );
      }
      overrideNote = `[${new Date().toISOString()}] Marked delivered without a code. Reason: ${reason}`;
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: status as any,
        ...(trackingNumber && { trackingNumber }),
        ...(trackingUrl && { trackingUrl }),
        // Stamped on the first move out of the building and never overwritten,
        // so re-applying SHIPPED after a correction does not reset the clock on
        // "how long did this take to go out?".
        ...(status === 'SHIPPED' && !existing.dispatchedAt && { dispatchedAt: new Date() }),
        ...(status === 'DELIVERED' && { deliveryDate: new Date() }),
        ...(overrideNote && {
          deliveryNotes: [existing.deliveryNotes, overrideNote].filter(Boolean).join('\n'),
        }),
      },
    });
    return this.withoutOtpSecret(updated);
  }

  /**
   * Admin-set delivery method and its details. Switching away from SELF clears
   * the rider's name and phone: leaving a person's name on an order the courier
   * is carrying makes the order lie about who has it.
   */
  async updateFulfilment(id: string, data: {
    fulfilmentType?: 'SELF' | 'DELHIVERY';
    deliveryPartnerName?: string | null;
    deliveryPartnerPhone?: string | null;
    deliveryNotes?: string | null;
    codCollected?: number | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
  }) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new AppError('Order not found', 404);

    const type = data.fulfilmentType ?? order.fulfilmentType;
    const switchingToCourier = type === 'DELHIVERY';

    const updated = await prisma.order.update({
      where: { id },
      data: {
        fulfilmentType: type,
        deliveryPartnerName:  switchingToCourier ? null : data.deliveryPartnerName  ?? order.deliveryPartnerName,
        deliveryPartnerPhone: switchingToCourier ? null : data.deliveryPartnerPhone ?? order.deliveryPartnerPhone,
        ...(data.deliveryNotes  !== undefined && { deliveryNotes: data.deliveryNotes }),
        ...(data.codCollected   !== undefined && { codCollected: data.codCollected }),
        ...(data.trackingNumber !== undefined && { trackingNumber: data.trackingNumber }),
        ...(data.trackingUrl    !== undefined && { trackingUrl: data.trackingUrl }),
      },
    });
    return this.withoutOtpSecret(updated);
  }

  async cancelOrder(id: string, userId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, userId, status: { in: ['PENDING', 'CONFIRMED'] } },
        include: { items: { select: { productId: true, variantId: true, quantity: true } } },
      });
      if (!order) throw new AppError('Order cannot be cancelled', 400);

      // Restore stock and reverse totalSold for every line item — the mirror
      // image of the decrement in createOrder. Cancelling an order must not
      // permanently leak inventory or leave totalSold inflated.
      for (const item of order.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQuantity: true, totalSold: true },
        });
        // Product may have been hard-deleted since the order was placed
        // (variants are hard-deletable per §18); nothing left to restore.
        if (!product) continue;

        const newStock = product.stockQuantity + item.quantity;
        // totalSold should never go negative, though it shouldn't in the
        // normal case — clamp defensively rather than trust it.
        const newSold = Math.max(0, product.totalSold - item.quantity);

        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: newStock, totalSold: newSold },
        });

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            type: 'RETURN',
            quantity: item.quantity,
            previousQty: product.stockQuantity,
            newQty: newStock,
            reason: 'Order cancelled',
            reference: order.orderNumber,
          },
        });
      }

      return tx.order.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
    });
  }
}

export const orderService = new OrderService();
