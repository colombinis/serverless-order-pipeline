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
  // --- 4E: branch gaps ---

  it('accepts an explicit expected list and builds an IN clause', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateOrderStatus('o1', 'PENDING', {}, { expected: ['PENDING', 'STOCK_VALIDATED'] });

    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ConditionExpression: '#status IN (:from0, :from1)',
      ExpressionAttributeValues: expect.objectContaining({
        ':from0': 'PENDING',
        ':from1': 'STOCK_VALIDATED',
      }),
    });
  });

  it('omits the condition when the target status has no guard', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateOrderStatus('o1', 'SOMETHING_ELSE');

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBeUndefined();
  });

  it('rethrows unexpected DynamoDB errors', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('boom'));

    await expect(updateOrderStatus('o1', 'CONFIRMED')).rejects.toThrow('boom');
  });

});