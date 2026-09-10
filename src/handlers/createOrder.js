const { v4: uuidv4 } = require('uuid');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { docClient } = require('../lib/dynamo');
const { response } = require('../lib/response');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * POST /orders
 * body: { "customerId": "cust-123", "items": [{ "sku": "ABC", "qty": 2 }] }
 *
 * Writes the order as PENDING and pushes it to SQS for async processing.
 * Returning fast here (202-style flow) is the key interview point:
 * the client is not blocked waiting for the whole fulfillment workflow.
 */
module.exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return response(400, { message: 'Invalid JSON body' });
  }

  const { customerId, items } = payload;

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return response(400, { message: 'customerId and a non-empty items array are required' });
  }

  const orderId = uuidv4();
  const now = new Date().toISOString();

  const order = {
    orderId,
    customerId,
    items,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: process.env.ORDERS_TABLE,
      Item: order,
    })
  );

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.ORDER_QUEUE_URL,
      MessageBody: JSON.stringify({ orderId }),
    })
  );

  return response(201, { orderId, status: order.status });
};
