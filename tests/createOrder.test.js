const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
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

  it('derives the same deterministic orderId for the same idempotencyKey', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: '1' });

    const body = {
      customerId: 'cust-123',
      items: [{ sku: 'ABC', qty: 2 }],
      idempotencyKey: 'key-42',
    };

    const first = await handler({ body: JSON.stringify(body) });
    const second = await handler({ body: JSON.stringify(body) });

    const firstParsed = JSON.parse(first.body);
    const secondParsed = JSON.parse(second.body);

    expect(firstParsed.orderId).toMatch(/^ord-[0-9a-f]{32}$/);
    expect(firstParsed.orderId).toBe(secondParsed.orderId);
    expect(secondParsed.replay).toBeUndefined();
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2);
    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 2);
  });

  it('replays the existing order when the same idempotencyKey is sent again', async () => {
    ddbMock
      .on(PutCommand)
      .rejectsOnce(
        Object.assign(new Error('ConditionalCheckFailedException'), {
          name: 'ConditionalCheckFailedException',
        })
      );
    ddbMock.on(GetCommand).resolves({
      Item: { orderId: 'ord-replay', status: 'PENDING', idempotencyKey: 'key-42' },
    });
    // No SQS mock: a replay must NOT re-enqueue.

    const body = {
      customerId: 'cust-123',
      items: [{ sku: 'ABC', qty: 2 }],
      idempotencyKey: 'key-42',
    };

    const result = await handler({ body: JSON.stringify(body) });
    const parsed = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(parsed).toMatchObject({ orderId: 'ord-replay', status: 'PENDING', replay: true });
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
    expect(ddbMock).toHaveReceivedCommandTimes(GetCommand, 1);
    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 0);
  });

  it('produces different orderIds for different idempotencyKeys', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: '1' });

    const a = JSON.parse((await handler({
      body: JSON.stringify({ customerId: 'c', items: [{ sku: 'A', qty: 1 }], idempotencyKey: 'k1' }),
    })).body);
    const b = JSON.parse((await handler({
      body: JSON.stringify({ customerId: 'c', items: [{ sku: 'A', qty: 1 }], idempotencyKey: 'k2' }),
    })).body);

    expect(a.orderId).not.toBe(b.orderId);
  });

  it('different customers with the same idempotencyKey get different orders', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: '1' });

    const a = JSON.parse((await handler({
      body: JSON.stringify({ customerId: 'c1', items: [{ sku: 'A', qty: 1 }], idempotencyKey: 'k' }),
    })).body);
    const b = JSON.parse((await handler({
      body: JSON.stringify({ customerId: 'c2', items: [{ sku: 'A', qty: 1 }], idempotencyKey: 'k' }),
    })).body);

    expect(a.orderId).not.toBe(b.orderId);
  });

  it('guards the create with a conditional write when idempotencyKey is present', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: '1' });

    await handler({
      body: JSON.stringify({ customerId: 'c', items: [{ sku: 'A', qty: 1 }], idempotencyKey: 'k' }),
    });

    expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
      ConditionExpression: 'attribute_not_exists(orderId)',
    });
  });
});
