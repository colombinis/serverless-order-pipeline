/**
 * Single source of truth for the CreateOrder payload contract.
 *
 * Kept dependency-free on purpose (the repo stays on AWS SDK + uuid only).
 * The OpenAPI document (`openapi.yaml`) is the human-facing contract; this
 * module is the executable one. If they ever diverge, this file wins.
 */

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

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
  } else {
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`items[${i}]: must be an object`);
        return;
      }
      if (!isNonEmptyString(item.sku)) {
        errors.push(`items[${i}].sku: must be a non-empty string`);
      }
      if (!Number.isInteger(item.qty) || item.qty < 1) {
        errors.push(`items[${i}].qty: must be an integer >= 1`);
      }
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

module.exports = { validateCreateOrder };
