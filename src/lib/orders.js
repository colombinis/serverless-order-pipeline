const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamo');

async function getOrder(orderId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: process.env.ORDERS_TABLE,
      Key: { orderId },
    })
  );
  return result.Item;
}

async function updateOrderStatus(orderId, status, extra = {}) {
  await docClient.send(
    new UpdateCommand({
      TableName: process.env.ORDERS_TABLE,
      Key: { orderId },
      UpdateExpression:
        'SET #status = :status, updatedAt = :updatedAt' +
        Object.keys(extra).map((k) => `, ${k} = :${k}`).join(''),
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': new Date().toISOString(),
        ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])),
      },
    })
  );
}

module.exports = { getOrder, updateOrderStatus };
