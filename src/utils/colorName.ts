/**
 * Resolve a human colour name to a hex swatch.
 *
 * The admin used to pick colours from a spectrum widget, which is precise but
 * wrong for a clothing catalogue: nobody merchandises "#8B4513", they
 * merchandise "Tan". Admins now type the name, which is also what the customer
 * reads on the product page.
 *
 * NOTE: nothing renders a swatch any more. The storefront and the admin both
 * show the colour NAME in a box, because deriving a hex from a name is lossy in
 * a way customers could see — "Blue" and "Light Blue" resolved to circles too
 * similar to tell apart, which is exactly how a denim product ended up offering
 * two identical blue dots. This is kept because the column is still written and
 * a future surface may want a hint colour; it is not on any display path.
 *
 * Covers the CSS named colours plus the terms that actually appear in fashion
 * merchandising and are not valid CSS. Unknown names return null, and the
 * caller decides what to do (we fall back to a neutral chip that still shows
 * the name, so an unrecognised colour degrades to text rather than a lie).
 */

const CSS_COLOURS: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000',
  blue: '#0000FF', yellow: '#FFFF00', orange: '#FFA500', purple: '#800080',
  pink: '#FFC0CB', brown: '#A52A2A', grey: '#808080', gray: '#808080',
  silver: '#C0C0C0', gold: '#FFD700', beige: '#F5F5DC', ivory: '#FFFFF0',
  navy: '#000080', teal: '#008080', maroon: '#800000', olive: '#808000',
  lime: '#00FF00', aqua: '#00FFFF', cyan: '#00FFFF', magenta: '#FF00FF',
  violet: '#EE82EE', indigo: '#4B0082', turquoise: '#40E0D0', tan: '#D2B48C',
  khaki: '#F0E68C', lavender: '#E6E6FA', salmon: '#FA8072', coral: '#FF7F50',
  crimson: '#DC143C', plum: '#DDA0DD', orchid: '#DA70D6', peru: '#CD853F',
  sienna: '#A0522D', chocolate: '#D2691E', tomato: '#FF6347',
  wheat: '#F5DEB3', linen: '#FAF0E6', mint: '#98FF98', peach: '#FFE5B4',
};

/**
 * Fashion vocabulary that is not valid CSS. These are the names that actually
 * come up on a garment label.
 */
const FASHION_COLOURS: Record<string, string> = {
  'off white': '#FAF9F6', offwhite: '#FAF9F6', cream: '#FFFDD0',
  ecru: '#C2B280', nude: '#E3BC9A', blush: '#DE5D83',
  'rose gold': '#B76E79', champagne: '#F7E7CE', mustard: '#FFDB58',
  rust: '#B7410E', terracotta: '#E2725B', burgundy: '#800020',
  wine: '#722F37', maroonred: '#800000', mauve: '#E0B0FF',
  lilac: '#C8A2C8', sage: '#9CAF88', 'sage green': '#9CAF88',
  olivegreen: '#708238', 'olive green': '#708238', emerald: '#50C878',
  'forest green': '#228B22', 'bottle green': '#006A4E', mint_green: '#98FF98',
  'baby pink': '#F4C2C2', 'hot pink': '#FF69B4', fuchsia: '#FF00FF',
  'powder blue': '#B0E0E6', 'sky blue': '#87CEEB', 'royal blue': '#4169E1',
  'ice blue': '#D6ECEF', denim: '#1560BD', indigoblue: '#3F00FF',
  charcoal: '#36454F', 'charcoal grey': '#36454F', slate: '#708090',
  stone: '#928E85', taupe: '#483C32', camel: '#C19A6B',
  chocolatebrown: '#7B3F00', 'coffee brown': '#4B3621', mocha: '#3B2F2F',
  'jet black': '#0A0A0A', 'pure white': '#FFFFFF',
  multicolour: '#CCCCCC', multicolor: '#CCCCCC', multi: '#CCCCCC',
  printed: '#CCCCCC', floral: '#CCCCCC',
};

/**
 * @returns hex string, or null when the name is not recognised.
 */
export const colorNameToHex = (name: string | null | undefined): string | null => {
  if (!name) return null;

  const raw = String(name).trim();
  if (!raw) return null;

  // Already a hex value (e.g. imported data, or an admin who typed one).
  if (/^#?[0-9a-f]{6}$/i.test(raw)) return raw.startsWith('#') ? raw.toUpperCase() : `#${raw.toUpperCase()}`;
  if (/^#?[0-9a-f]{3}$/i.test(raw)) {
    const h = raw.replace('#', '');
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }

  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  if (FASHION_COLOURS[key]) return FASHION_COLOURS[key];
  if (CSS_COLOURS[key]) return CSS_COLOURS[key];

  // "Dark Olive", "Light Blue" — fall back to the base word so a qualified
  // name still produces a sensible swatch rather than nothing.
  const words = key.split(' ');
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (FASHION_COLOURS[w]) return FASHION_COLOURS[w];
    if (CSS_COLOURS[w]) return CSS_COLOURS[w];
  }

  return null;
};
