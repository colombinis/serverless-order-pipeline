const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

process.env.ORDERS_TABLE = 'test-orders-table';

const { handler } = require('../src/handlers/confirmOrder');

describe('confirmOrder handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(UpdateCommand).resolves({});
  });

  it('moves the order to CONFIRMED only from PAYMENT_CHARGED', async () => {
    const result = await handler({ orderId: 'o-1' });

    expect(result).toEqual({ orderId: 'o-1' });
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      TableName: 'test-orders-table',
      Key: { orderId: 'o-1' },
      ConditionExpression: '#status = :from0',
      ExpressionAttributeValues: expect.objectContaining({
        ':status': 'CONFIRMED',
        ':from0': 'PAYMENT_CHARGED',
      }),
    });
  });

  it('is idempotent: a rejected transition is not an error', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cancelled'), { name: 'ConditionalCheckFailedException' }));

    await expect(handler({ orderId: 'o-1' })).resolves.toEqual({ orderId: 'o-1' });
  });
});
