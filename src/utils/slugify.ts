import slugifyLib from 'slugify';

export const createSlug = (text: string): string => {
  return slugifyLib(text, {
    lower: true,
    strict: true,
    trim: true,
  });
};

export const generateOrderNumber = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
};

export const paginationParams = (page?: string | number, limit?: string | number) => {
  const p = Math.max(1, parseInt(String(page || 1), 10));
  const l = Math.min(100, Math.max(1, parseInt(String(limit || 20), 10)));
  return { page: p, limit: l, skip: (p - 1) * l };
};
