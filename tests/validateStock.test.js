const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

process.env.ORDERS_TABLE = 'test-orders-table';

const { handler } = require('../src/handlers/validateStock');

describe('validateStock handler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('throws when the order does not exist', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    await expect(handler({ orderId: 'missing-order' })).rejects.toThrow(/not found/);
  });

  it('throws when any item exceeds available stock', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { orderId: 'o1', items: [{ sku: 'ABC', qty: 500 }] },
    });

    await expect(handler({ orderId: 'o1' })).rejects.toThrow(/Insufficient stock/);
  });

  it('marks the order as STOCK_VALIDATED when stock is sufficient', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { orderId: 'o1', items: [{ sku: 'ABC', qty: 2 }] },
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler({ orderId: 'o1' });

    expect(result).toEqual({ orderId: 'o1' });
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ExpressionAttributeValues: expect.objectContaining({ ':status': 'STOCK_VALIDATED' }),
    });
  });
});
