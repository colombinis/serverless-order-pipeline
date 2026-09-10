const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

process.env.ORDERS_TABLE = 'test-orders-table';
process.env.ORDER_QUEUE_URL = 'https://sqs.fake/queue';

// Import after env vars are set, since the handler reads them at module load in some setups
const { handler } = require('../src/handlers/createOrder');

describe('createOrder handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = await handler({ body: '{invalid' });
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const result = await handler({ body: JSON.stringify({ customerId: 'c1' }) });
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toMatch(/items/);
  });

  it('creates an order, writes to DynamoDB and pushes to SQS', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: '1' });

    const body = {
      customerId: 'cust-123',
      items: [{ sku: 'ABC', qty: 2 }],
    };

    const result = await handler({ body: JSON.stringify(body) });
    const parsed = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(parsed.status).toBe('PENDING');
    expect(parsed.orderId).toBeDefined();

    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1);
  });
});
