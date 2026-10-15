/**
 * Single source of truth for the CreateOrder payload contract.
 *
 * Kept dependency-free on purpose (the repo stays on AWS SDK + uuid only).
 * The OpenAPI document (`openapi.yaml`) is the human-facing contract; this
 * module is the executable one. If they ever diverge, this file wins.
 */

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const MAX_ITEMS_PER_ORDER = 50;

/**
 * Validate a parsed CreateOrder body.
 * @returns {{ ok: true, value: { customerId: string, items: object[], idempotencyKey?: string } }
 *          | { ok: false, errors: string[] }}
 */
function validateCreateOrder(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['body: must be a JSON object'] };
  }

  const { customerId, items, idempotencyKey } = payload;
  const errors = [];

  if (!isNonEmptyString(customerId)) {
    errors.push('customerId: must be a non-empty string');
  }

  if (idempotencyKey !== undefined && !isNonEmptyString(idempotencyKey)) {
    errors.push('idempotencyKey: must be a non-empty string when provided');
  }

  if (!Array.isArray(items) || items.length === 0) {
    errors.push('items: must be a non-empty array');
  } else if (items.length > MAX_ITEMS_PER_ORDER) {
    errors.push(`items: must have at most ${MAX_ITEMS_PER_ORDER} items`);
  } else {
    items.forEach((item, i) => {
      errors.push(...validateItem(item, i));
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { customerId, items, ...(idempotencyKey ? { idempotencyKey } : {}) },
  };
}

/**
 * Validate a single order item and return its errors (if any).
 * @param {object} item - the item to validate
 * @param {number} i - index of the item in the items array
 * @returns {string[]} validation errors for this item
 */
function validateItem(item, i) {
  const itemErrors = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    itemErrors.push(`items[${i}]: must be an object`);
    return itemErrors;
  }
  if (!isNonEmptyString(item.sku)) {
    itemErrors.push(`items[${i}].sku: must be a non-empty string`);
  }
  if (!Number.isInteger(item.qty) || item.qty < 1) {
    itemErrors.push(`items[${i}].qty: must be an integer >= 1`);
  }
  return itemErrors;
}

module.exports = { validateCreateOrder };
