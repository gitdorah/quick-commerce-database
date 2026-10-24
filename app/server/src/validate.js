import { HttpError } from './errors.js';

export const ORDER_STATUSES = [
  'Confirmed',
  'Preparing',
  'Out for Delivery',
  'Delivered',
  'Cancelled',
];

export const INVENTORY_STATES = ['Available', 'Reserved', 'Damaged', 'In-Transit'];

export function intInRange(value, field, min, max = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `between ${min} and ${max}`;
    throw new HttpError(400, `${field} must be an integer ${range}`);
  }
  return number;
}

export function positiveInt(value, field) {
  return intInRange(value, field, 1);
}

export function nonNegativeInt(value, field) {
  return intInRange(value, field, 0);
}

export function optional(value, validator, field) {
  return value === undefined || value === null || value === '' ? undefined : validator(value, field);
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function requiredText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HttpError(400, `${field} is required`);
  if (text.length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters`);
  }
  return text;
}

export function cartItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'items must be a non-empty array');
  }
  if (value.length > 100) {
    throw new HttpError(400, 'A cart can contain at most 100 lines');
  }
  return value.map((item, index) => ({
    productId: positiveInt(item?.productId, `items[${index}].productId`),
    quantity: intInRange(item?.quantity, `items[${index}].quantity`, 1, 1000),
  }));
}
