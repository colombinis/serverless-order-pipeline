const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamo');
const { getOrder, updateOrderStatus } = require('../lib/orders');
const { logger, metrics, MetricUnit } = require('../lib/observability');

const INVENTORY_TABLE = process.env.INVENTORY_TABLE;
const RESERVATIONS_TABLE = process.env.RESERVATIONS_TABLE;

/**
 * Step Functions Task. Input: { orderId }
 *
 * Conditional inventory reservation (Tarea 2):
 * - ONE DynamoDB transaction = (a) Put the order's reservation (idempotency guard:
 *   only if it does not exist yet) + (b) one Update per SKU that decrements stock
 *   (guard: available >= qty).
 * - All-or-nothing: if any SKU is short, the whole transaction aborts and NO stock
 *   is touched. That is what prevents overselling under concurrency without locks.
 * - TransactionCanceledException is inspected to tell "already reserved"
 *   (idempotent replay) from "out of stock".
 */
module.exports.handler = async ({ orderId }) => {
  const order = await getOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  // Aggregate per SKU: a transaction cannot touch the same item twice.
  const quantities = new Map();
  for (const item of order.items || []) {
    quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.qty);
  }
  const entries = [...quantities.entries()];

  const transactItems = [
    {
      Put: {
        TableName: RESERVATIONS_TABLE,
        Item: {
          orderId,
          items: entries.map(([sku, qty]) => ({ sku, qty })),
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(orderId)',
      },
    },
    ...entries.map(([sku, qty]) => ({
      Update: {
        TableName: INVENTORY_TABLE,
        Key: { sku },
        UpdateExpression: 'SET available = available - :qty',
        ConditionExpression: 'attribute_exists(sku) AND available >= :qty',
        ExpressionAttributeValues: { ':qty': qty },
      },
    })),
  ];

  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons || [];
      // reasons[0] is the reservation Put; a failure there = already reserved.
      const alreadyReserved = reasons[0]?.Code === 'ConditionalCheckFailed';
      const stockShort = reasons.slice(1).some((r) => r?.Code === 'ConditionalCheckFailed');

      if (alreadyReserved) {
        logger.info('Inventory already reserved (replay)', { orderId });
        return { orderId, alreadyReserved: true };
      }
      if (stockShort) {
        logger.warn('Out of stock', { orderId });
        metrics.addMetric('OutOfStock', MetricUnit.Count, 1);
        metrics.publishStoredMetrics();
        const e = new Error(`Insufficient stock for order ${orderId}`);
        e.name = 'OutOfStock'; // named error the state machine can catch specifically
        throw e;
      }
    }
    throw err;
  }

  await updateOrderStatus(orderId, 'INVENTORY_RESERVED');
  logger.info('Inventory reserved', { orderId });
  
  return { orderId };
};