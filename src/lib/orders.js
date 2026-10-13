const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamo');

/**
 * Allowed "from" status(es) per forward transition. A target status not listed
 * here (CANCELLED) can be reached from any state. The guard turns a repeated
 * execution into a no-op instead of moving the order's state backwards.
 */
const ALLOWED_FROM = {
  STOCK_VALIDATED: ['PENDING'],
  INVENTORY_RESERVED: ['STOCK_VALIDATED'],
  PAYMENT_CHARGED: ['INVENTORY_RESERVED'],
  CONFIRMED: ['PAYMENT_CHARGED'],
};

async function getOrder(orderId) {
  const result = await docClient.send(
    new GetCommand({ TableName: process.env.ORDERS_TABLE, Key: { orderId } })
  );
  return result.Item;
}

/**
 * Update an order's status, guarded by the expected previous status.
 * @param {string} orderId
 * @param {string} status  target status
 * @param {object} [extra] extra attributes to SET (e.g. cancelReason)
 * @param {object} [options]
 * @param {string[]} [options.expected] override the allowed "from" statuses
 * @returns {Promise<{ updated: boolean }>} updated=false when the guard rejected
 *          the write (the transition already happened => idempotent no-op).
 */
async function updateOrderStatus(orderId, status, extra = {}, options = {}) {
  const expected = options.expected !== undefined ? options.expected : ALLOWED_FROM[status];

  const setParts = ['#status = :status', 'updatedAt = :updatedAt'];
  const values = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])),
  };
  Object.keys(extra).forEach((k) => setParts.push(`${k} = :${k}`));

  const conditionParts = [];
  if (Array.isArray(expected) && expected.length > 0) {
    const placeholders = expected.map((_, i) => `:from${i}`);
    expected.forEach((s, i) => {
      values[`:from${i}`] = s;
    });
    conditionParts.push(
      placeholders.length === 1 ? `#status = ${placeholders[0]}` : `#status IN (${placeholders.join(', ')})`
    );
  }
  // Terminal status: never rewrite it (keeps the first cancelReason intact).
  if (status === 'CANCELLED') conditionParts.push('#status <> :status');

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: process.env.ORDERS_TABLE,
        Key: { orderId },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: values,
        ...(conditionParts.length ? { ConditionExpression: conditionParts.join(' AND ') } : {}),
      })
    );
    return { updated: true };
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') return { updated: false };
    throw err;
  }
}

module.exports = { getOrder, updateOrderStatus };