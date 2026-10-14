const { TransactWriteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { docClient } = require('../lib/dynamo');
const { updateOrderStatus } = require('../lib/orders');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const INVENTORY_TABLE = process.env.INVENTORY_TABLE;
const RESERVATIONS_TABLE = process.env.RESERVATIONS_TABLE;

/**
 * Releases the order's reservation back to inventory, exactly once.
 * - No reservation (e.g. failed before ReserveInventory): nothing to release.
 * - Already released (retry): the `attribute_not_exists(releasedAt)` guard aborts
 *   the transaction, so stock is not added back twice.
 * Returns true if it released, false if there was nothing to release.
 */
async function releaseReservation(orderId) {
  const { Item: reservation } = await docClient.send(
    new GetCommand({ TableName: RESERVATIONS_TABLE, Key: { orderId } })
  );
  if (!reservation) return false;

  const items = reservation.items || [];

  const transactItems = [
    ...items.map(({ sku, qty }) => ({
      Update: {
        TableName: INVENTORY_TABLE,
        Key: { sku },
        UpdateExpression: 'SET available = available + :qty',
        ConditionExpression: 'attribute_exists(sku)',
        ExpressionAttributeValues: { ':qty': qty },
      },
    })),
    {
      Update: {
        TableName: RESERVATIONS_TABLE,
        Key: { orderId },
        UpdateExpression: 'SET releasedAt = :now',
        ConditionExpression: 'attribute_exists(orderId) AND attribute_not_exists(releasedAt)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      },
    },
  ];

  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return true;
  } catch (err) {
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons || [];
      const last = reasons[reasons.length - 1];
      if (last?.Code === 'ConditionalCheckFailed') return false; // already released: idempotent no-op
    }
    throw err;
  }
}

/**
 * Step Functions Task. Reached via `Catch` from any earlier step.
 * Input includes the original payload plus an `error` field added by
 * the state machine's ResultPath.
 */
module.exports.handler = async ({ orderId, error }) => {
  await releaseReservation(orderId);

  await updateOrderStatus(orderId, 'CANCELLED', {
    cancelReason: error?.Cause || 'Unknown error',
  });

  await snsClient.send(
    new PublishCommand({
      TopicArn: process.env.NOTIFICATIONS_TOPIC_ARN,
      Subject: `Order ${orderId} cancelled`,
      Message: `Order ${orderId} could not be fulfilled and was cancelled.`,
    })
  );

  return { orderId, status: 'CANCELLED' };
};