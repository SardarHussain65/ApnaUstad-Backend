/** CNIC helpers: Pakistani CNIC format is 13 digits, written XXXXX-XXXXXXX-X. */

export const CNIC_REGEX = /^\d{5}-\d{7}-\d$/;

/** Accepts both dashed and plain 13-digit input; returns the dashed form or null. */
export const normalizeCnic = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};

export const isValidCnic = (value: unknown): boolean => normalizeCnic(value) !== null;

/** `35202-1234567-1` -> `35202-*****67-1` (keeps district, last two digits and check digit). */
export const maskCnic = (value: string): string => {
  const normalized = normalizeCnic(value);
  if (!normalized) return value ? '*************' : value;
  return `${normalized.slice(0, 5)}-*****${normalized.slice(11, 13)}-${normalized.slice(14)}`;
};

const CNIC_KEYS = new Set(['cnicNumber', 'cnic']);

/**
 * Recursively masks CNIC number fields in an API payload (returns a new structure).
 * Image URLs are intentionally left alone; they are gated by the reveal endpoint on the UI side.
 * Safely handles Mongoose document instances and prevents circular traversal.
 */
export const maskCnicDeep = <T>(input: T, seen = new WeakSet<object>()): T => {
  if (Array.isArray(input)) return input.map((item) => maskCnicDeep(item, seen)) as unknown as T;
  if (input && typeof input === 'object') {
    if (input instanceof Date || input instanceof RegExp) return input;

    // Preserve and stringify MongoDB ObjectId / BSON instances
    const ctorName = input.constructor?.name;
    if (
      ctorName === 'ObjectId' ||
      ctorName === 'ObjectID' ||
      (input as any)._bsontype === 'ObjectID' ||
      (input as any)._bsontype === 'ObjectId' ||
      typeof (input as any).toHexString === 'function'
    ) {
      return String(input) as unknown as T;
    }

    if (seen.has(input)) return input;
    seen.add(input);

    let target: any = input;
    if (typeof target.toObject === 'function') {
      target = target.toObject();
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(target)) {
      if (key.startsWith('$') || key === '_doc' || key === '$__') continue;
      if (CNIC_KEYS.has(key) && typeof val === 'string' && val) {
        out[key] = maskCnic(val);
        out.cnicMasked = true;
      } else {
        out[key] = maskCnicDeep(val, seen);
      }
    }
    return out as T;
  }
  return input;
};
