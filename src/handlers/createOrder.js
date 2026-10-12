const { v4: uuidv4 } = require('uuid');
const { createHash } = require('crypto');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { docClient } = require('../lib/dynamo');
const { response, problem } = require('../lib/response');
const { validateCreateOrder } = require('../domain/orderSchema');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * POST /orders
 * body: { "customerId": "cust-123", "items": [{ "sku": "ABC", "qty": 2 }], "idempotencyKey": "abc-123" }
 *
 * Responds `201 Created` (not 202): it creates the PENDING order resource
 * before replying, and advertises it with a `Location` header. Fulfillment
 * itself is asynchronous. See lessons/0004-201-vs-202-createOrder.html.
 *
 * Idempotent when the client sends an `idempotencyKey`: the orderId is DERIVED
 * from (customerId + idempotencyKey) instead of a random uuid, so a retry with
 * the same key lands on the SAME order (conditional write fails -> replay).
 * A `requestHash` is stored so that reusing the key with a DIFFERENT body is
 * rejected with 422 instead of silently replaying the first order.
 *
 * Errors use RFC 9457 `application/problem+json`.
 * Known gap (part of lesson 5 / cure B): if the PutItem succeeds but the SQS
 * send fails, the order exists but its event never reached the queue (orphan
 * PENDING). The complete cure is the transaction outbox.
 */
function deterministicOrderId(customerId, idempotencyKey) {
  const hash = createHash('sha256')
    .update(`${customerId}|${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `ord-${hash}`;
}

// Hash of the business payload (not the key) used to detect key reuse.
function requestHashOf({ customerId, items }) {
  return createHash('sha256').update(JSON.stringify({ customerId, items })).digest('hex');
}

const locationOf = (orderId) => ({ Location: `/orders/${orderId}` });

module.exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return problem(400, 'Malformed JSON', 'The request body is not valid JSON.');
  }

  const parsed = validateCreateOrder(payload);
  if (!parsed.ok) {
    return problem(422, 'Invalid order', parsed.errors.join('; '));
  }

  const { customerId, items, idempotencyKey } = parsed.value;
  const now = new Date().toISOString();
  const orderId = idempotencyKey
    ? deterministicOrderId(customerId, idempotencyKey)
    : uuidv4();
  const requestHash = idempotencyKey ? requestHashOf({ customerId, items }) : undefined;

  const order = {
    orderId,
    customerId,
    items,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    ...(idempotencyKey ? { idempotencyKey, requestHash } : {}),
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
        // Same key + different body: reject instead of replaying the wrong order.
        if (existing.Item.requestHash && existing.Item.requestHash !== requestHash) {
          return problem(
            422,
            'Idempotency key reuse',
            'This idempotencyKey was already used with a different request body.'
          );
        }
        return response(
          201,
          { orderId: existing.Item.orderId, status: existing.Item.status, replay: true },
          locationOf(existing.Item.orderId)
        );
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

  return response(201, { orderId, status: order.status }, locationOf(orderId));
};
