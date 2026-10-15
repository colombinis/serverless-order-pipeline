const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const ddbMock = mockClient(DynamoDBDocumentClient);

// The handler reads env at module load: set it BEFORE requiring it.
process.env.ORDERS_TABLE = 'test-orders-table';
process.env.INVENTORY_TABLE = 'test-inventory-table';
process.env.RESERVATIONS_TABLE = 'test-reservations-table';

const { handler } = require('../src/handlers/reserveInventory');

/** A TransactionCanceledException whose CancellationReasons may be absent. */
const canceled = (reasons) =>
  Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    ...(reasons === undefined ? {} : { CancellationReasons: reasons }),
  });

const orderWith = (items) => ({
  Item: { orderId: 'o-1', status: 'STOCK_VALIDATED', items },
});

describe('reserveInventory handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves(orderWith([{ sku: 'ABC', qty: 2 }]));
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
  });

  it('reserves stock in one transaction and then moves the order to INVENTORY_RESERVED', async () => {
    const result = await handler({ orderId: 'o-1' });

    expect(result).toEqual({ orderId: 'o-1' });

    // (a) the reservation Put carries the idempotency guard
    expect(ddbMock).toHaveReceivedCommandWith(TransactWriteCommand, {
      TransactItems: expect.arrayContaining([
        expect.objectContaining({
          Put: expect.objectContaining({
            TableName: 'test-reservations-table',
            ConditionExpression: 'attribute_not_exists(orderId)',
            Item: expect.objectContaining({ orderId: 'o-1', items: [{ sku: 'ABC', qty: 2 }] }),
          }),
        }),
      ]),
    });

    // (b) the decrement cannot go negative
    expect(ddbMock).toHaveReceivedCommandWith(TransactWriteCommand, {
      TransactItems: expect.arrayContaining([
        expect.objectContaining({
          Update: expect.objectContaining({
            TableName: 'test-inventory-table',
            Key: { sku: 'ABC' },
            ConditionExpression: 'attribute_exists(sku) AND available >= :qty',
            ExpressionAttributeValues: { ':qty': 2 },
          }),
        }),
      ]),
    });

    // (c) the status advances only after the reservation succeeded
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      Key: { orderId: 'o-1' },
      ExpressionAttributeValues: expect.objectContaining({ ':status': 'INVENTORY_RESERVED' }),
    });
  });

  it('aggregates repeated SKUs into a single decrement (a transaction cannot touch an item twice)', async () => {
    ddbMock
      .on(GetCommand)
      .resolves(orderWith([{ sku: 'ABC', qty: 2 }, { sku: 'XYZ', qty: 1 }, { sku: 'ABC', qty: 3 }]));

    await handler({ orderId: 'o-1' });

    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    const updates = items.filter((i) => i.Update).map((i) => i.Update);

    expect(updates).toHaveLength(2);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Key: { sku: 'ABC' }, ExpressionAttributeValues: { ':qty': 5 } }),
        expect.objectContaining({ Key: { sku: 'XYZ' }, ExpressionAttributeValues: { ':qty': 1 } }),
      ])
    );
  });

  it('reserves nothing but still advances an order with no items', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { orderId: 'o-1', status: 'STOCK_VALIDATED' } });

    await handler({ orderId: 'o-1' });

    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items.filter((i) => i.Update)).toHaveLength(0);
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ExpressionAttributeValues: expect.objectContaining({ ':status': 'INVENTORY_RESERVED' }),
    });
  });

  it('throws when the order does not exist and never opens a transaction', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    await expect(handler({ orderId: 'ghost' })).rejects.toThrow('Order ghost not found');
    expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
  });

  it('reports a replay when the reservation already exists, without touching the status', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled([{ Code: 'ConditionalCheckFailed' }]));

    const result = await handler({ orderId: 'o-1' });

    expect(result).toEqual({ orderId: 'o-1', alreadyReserved: true });
    expect(ddbMock).not.toHaveReceivedCommand(UpdateCommand);
  });

  it('throws a named OutOfStock error when a SKU cannot be reserved', async () => {
    ddbMock
      .on(TransactWriteCommand)
      .rejects(canceled([{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]));

    await expect(handler({ orderId: 'o-1' })).rejects.toMatchObject({ name: 'OutOfStock' });
    expect(ddbMock).not.toHaveReceivedCommand(UpdateCommand);
  });

  it('rethrows a cancellation that has no reasons at all', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled([]));

    await expect(handler({ orderId: 'o-1' })).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
  });

  it('rethrows a cancellation whose stock reason entry is missing', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled([{ Code: 'None' }, null]));

    await expect(handler({ orderId: 'o-1' })).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
  });

  it('rethrows a cancellation without a CancellationReasons field', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(undefined));

    await expect(handler({ orderId: 'o-1' })).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
  });

  it('rethrows unexpected DynamoDB errors', async () => {
    ddbMock.on(TransactWriteCommand).rejects(new Error('boom'));

    await expect(handler({ orderId: 'o-1' })).rejects.toThrow('boom');
  });
});
