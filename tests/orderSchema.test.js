const { validateCreateOrder } = require('../src/domain/orderSchema');

/**
 * Unit tests for the executable contract. The handler tests exercise this
 * module too, but only through payloads that reach the DynamoDB/SQS path --
 * the rejection branch of every rule is only reachable from here.
 */
describe('validateCreateOrder', () => {
  it('accepts a minimal valid order and omits idempotencyKey', () => {
    const result = validateCreateOrder({ customerId: 'c1', items: [{ sku: 'ABC', qty: 2 }] });

    expect(result).toEqual({
      ok: true,
      value: { customerId: 'c1', items: [{ sku: 'ABC', qty: 2 }] },
    });
    expect(result.value).not.toHaveProperty('idempotencyKey');
  });

  it('passes the idempotencyKey through when it is provided', () => {
    const result = validateCreateOrder({
      customerId: 'c1',
      items: [{ sku: 'A', qty: 1 }],
      idempotencyKey: 'k1',
    });

    expect(result.ok).toBe(true);
    expect(result.value.idempotencyKey).toBe('k1');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not-an-object'],
    ['an array', []],
  ])('rejects %s as the body', (_label, payload) => {
    expect(validateCreateOrder(payload)).toEqual({
      ok: false,
      errors: ['body: must be a JSON object'],
    });
  });

  it('rejects a missing, blank or non-string customerId', () => {
    const items = [{ sku: 'A', qty: 1 }];
    const expected = { ok: false, errors: ['customerId: must be a non-empty string'] };

    expect(validateCreateOrder({ items })).toEqual(expected);
    expect(validateCreateOrder({ customerId: '   ', items })).toEqual(expected);
    expect(validateCreateOrder({ customerId: 42, items })).toEqual(expected);
  });

  it('rejects a blank idempotencyKey (but accepts an absent one)', () => {
    expect(
      validateCreateOrder({ customerId: 'c', items: [{ sku: 'A', qty: 1 }], idempotencyKey: '' })
    ).toEqual({
      ok: false,
      errors: ['idempotencyKey: must be a non-empty string when provided'],
    });
  });

  it('rejects a missing or empty items array', () => {
    expect(validateCreateOrder({ customerId: 'c' })).toEqual({
      ok: false,
      errors: ['items: must be a non-empty array'],
    });
    expect(validateCreateOrder({ customerId: 'c', items: [] })).toEqual({
      ok: false,
      errors: ['items: must be a non-empty array'],
    });
  });

  it.each([
    ['a string', 'nope'],
    ['null', null],
    ['an array', ['nested']],
  ])('rejects an item that is %s', (_label, item) => {
    expect(validateCreateOrder({ customerId: 'c', items: [item] })).toEqual({
      ok: false,
      errors: ['items[0]: must be an object'],
    });
  });

  it('rejects an item with a blank or non-string sku', () => {
    expect(validateCreateOrder({ customerId: 'c', items: [{ sku: '', qty: 1 }] })).toEqual({
      ok: false,
      errors: ['items[0].sku: must be a non-empty string'],
    });
    expect(validateCreateOrder({ customerId: 'c', items: [{ qty: 1 }] })).toEqual({
      ok: false,
      errors: ['items[0].sku: must be a non-empty string'],
    });
  });

  it('reports every problem at once, with the offending index', () => {
    const result = validateCreateOrder({
      customerId: '',
      items: [{ sku: 'A', qty: 0 }, 'bad'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'customerId: must be a non-empty string',
      'items[0].qty: must be an integer >= 1',
      'items[1]: must be an object',
    ]);
  });
});
