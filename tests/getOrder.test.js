const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

process.env.ORDERS_TABLE = 'test-orders-table';

const { handler } = require('../src/handlers/getOrder');

describe('getOrder handler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns 200 with the order when it exists', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        orderId: 'ord-1',
        customerId: 'c1',
        status: 'CONFIRMED',
        items: [{ sku: 'A', qty: 1 }],
      },
    });

    const result = await handler({ pathParameters: { orderId: 'ord-1' } });
    const parsed = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(parsed).toMatchObject({ orderId: 'ord-1', status: 'CONFIRMED' });
    expect(ddbMock).toHaveReceivedCommandWith(GetCommand, {
      TableName: 'test-orders-table',
      Key: { orderId: 'ord-1' },
    });
  });

  it('returns 404 (problem+json) when the order does not exist', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await handler({ pathParameters: { orderId: 'ghost' } });

    expect(result.statusCode).toBe(404);
    expect(result.headers['Content-Type']).toBe('application/problem+json');
    expect(JSON.parse(result.body).title).toBe('Order not found');
  });

  it('returns 400 (problem+json) when orderId is missing', async () => {
    const result = await handler({ pathParameters: {} });

    expect(result.statusCode).toBe(400);
    expect(result.headers['Content-Type']).toBe('application/problem+json');
    expect(JSON.parse(result.body).title).toBe('Missing orderId');
  });
});
