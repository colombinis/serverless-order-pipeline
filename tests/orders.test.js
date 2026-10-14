const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

process.env.ORDERS_TABLE = 'orders-test';
const ddbMock = mockClient(DynamoDBDocumentClient);
const { updateOrderStatus } = require('../src/lib/orders');

describe('updateOrderStatus guards', () => {
  beforeEach(() => ddbMock.reset());

  it('guards a forward transition with the expected previous status', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const res = await updateOrderStatus('o1', 'CONFIRMED');
    expect(res).toEqual({ updated: true });
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ConditionExpression: '#status = :from0',
      ExpressionAttributeValues: expect.objectContaining({
        ':status': 'CONFIRMED',
        ':from0': 'PAYMENT_CHARGED',
      }),
    });
  });

  it('returns updated:false when the guard rejects (idempotent no-op)', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('rejected'), { name: 'ConditionalCheckFailedException' }));
    expect(await updateOrderStatus('o1', 'CONFIRMED')).toEqual({ updated: false });
  });

  it('never rewrites a terminal CANCELLED status', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateOrderStatus('o1', 'CANCELLED', { cancelReason: 'nope' });
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ConditionExpression: '#status <> :status',
    });
  });
});