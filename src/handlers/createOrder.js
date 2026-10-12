const { v4: uuidv4 } = require('uuid');
const { createHash } = require('crypto');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { docClient } = require('../lib/dynamo');
const { response } = require('../lib/response');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * POST /orders
 * body: { "customerId": "cust-123", "items": [{ "sku": "ABC", "qty": 2 }], "idempotencyKey": "abc-123" }
 *
 * Idempotent when the client sends an `idempotencyKey`: the orderId is DERIVED from
 * (customerId + idempotencyKey) instead of a random uuid, so a retry with the same
 * key lands on the SAME order (conditional write fails -> return the existing order).
 * The conditional write doubles as the concurrency lock: two identical concurrent
 * requests -> exactly one wins and creates; the loser replays.
 *
 * Without idempotencyKey, behavior is the classic uuidv4() path (non-idempotent).
 *
 * Known gap (Part of lesson 5 / cure B): if the PutItem succeeds but the SQS send
 * fails, the order exists but its event never reached the queue (orphan PENDING).
 * The complete cure is the transaction outbox (TransactWriteItems + DynamoDB Streams).
 */
function deterministicOrderId(customerId, idempotencyKey) {
  const hash = createHash('sha256')
    .update(`${customerId}|${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `ord-${hash}`;
}

module.exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return response(400, { message: 'Invalid JSON body' });
  }

  const { customerId, items, idempotencyKey } = payload;

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return response(400, { message: 'customerId and a non-empty items array are required' });
  }

  const now = new Date().toISOString();
  const orderId = idempotencyKey
    ? deterministicOrderId(customerId, idempotencyKey)
    : uuidv4();

  const order = {
    orderId,
    customerId,
    items,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: process.env.ORDERS_TABLE,
        Item: order,
        // Atomic guard: only creates if this deterministic orderId does NOT exist yet.
        // A failed condition means the original request already ran -> replay below.
        ...(idempotencyKey ? { ConditionExpression: 'attribute_not_exists(orderId)' } : {}),
      })
    );
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException' && idempotencyKey) {
      const existing = await docClient.send(
        new GetCommand({
          TableName: process.env.ORDERS_TABLE,
          Key: { orderId },
        })
      );
      if (existing.Item) {
        return response(201, {
          orderId: existing.Item.orderId,
          status: existing.Item.status,
          replay: true,
        });
      }
    }
    throw err;
  }

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.ORDER_QUEUE_URL,
      MessageBody: JSON.stringify({ orderId }),
    })
  );

  return response(201, { orderId, status: order.status });
};