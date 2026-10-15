const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

delete process.env.AWS_REGION; // deterministic: exercises the region fallback
process.env.ORDERS_TABLE = 'test-orders-table';
process.env.INVENTORY_TABLE = 'test-inventory-table';
process.env.RESERVATIONS_TABLE = 'test-reservations-table';
process.env.NOTIFICATIONS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';

const { handler } = require('../src/handlers/cancelOrder');

describe('cancelOrder handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    snsMock.reset();
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(TransactWriteCommand).resolves({});
    snsMock.on(PublishCommand).resolves({});
  });

  it('releases the reservation once and cancels the order', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { orderId: 'o1', items: [{ sku: 'LIMITED', qty: 2 }] },
    });

    const result = await handler({ orderId: 'o1', error: { Cause: 'OutOfStock' } });

    expect(result).toEqual({ orderId: 'o1', status: 'CANCELLED' });
    // (a) el stock vuelve a subir
    expect(ddbMock).toHaveReceivedCommandWith(TransactWriteCommand, {
      TransactItems: expect.arrayContaining([
        expect.objectContaining({
          Update: expect.objectContaining({
            TableName: 'test-inventory-table',
            UpdateExpression: 'SET available = available + :qty',
            ExpressionAttributeValues: { ':qty': 2 },
          }),
        }),
      ]),
    });
    // (b) la reserva se marca liberada exactamente una vez
    expect(ddbMock).toHaveReceivedCommandWith(TransactWriteCommand, {
      TransactItems: expect.arrayContaining([
        expect.objectContaining({
          Update: expect.objectContaining({
            ConditionExpression: 'attribute_exists(orderId) AND attribute_not_exists(releasedAt)',
          }),
        }),
      ]),
    });
    // (c) y la orden queda CANCELLED con el motivo del Catch
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ExpressionAttributeValues: expect.objectContaining({
        ':status': 'CANCELLED',
        ':cancelReason': 'OutOfStock',
      }),
    });
  });

  it('does not release twice when the reservation was already released', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { orderId: 'o1', items: [{ sku: 'LIMITED', qty: 2 }] },
    });
    ddbMock.on(TransactWriteCommand).rejects(
      Object.assign(new Error('cancelled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
      })
    );

    const result = await handler({ orderId: 'o1' });

    expect(result).toEqual({ orderId: 'o1', status: 'CANCELLED' });
    expect(snsMock).toHaveReceivedCommand(PublishCommand);
  });

  it('is a no-op on inventory when there is no reservation', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await handler({ orderId: 'o1' });

    expect(result).toEqual({ orderId: 'o1', status: 'CANCELLED' });
    expect(ddbMock).not.toHaveReceivedCommand(TransactWriteCommand);
    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ExpressionAttributeValues: expect.objectContaining({ ':status': 'CANCELLED' }),
    });
  });
  // --- 4E: branch gaps ---

  it('releases nothing extra when the reservation has no items', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { orderId: 'o1' } });

    const result = await handler({ orderId: 'o1' });

    expect(result).toEqual({ orderId: 'o1', status: 'CANCELLED' });
    // Only the "released" marker is written: there is nothing to add back.
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items).toHaveLength(1);
  });

  it('rethrows a cancellation whose reasons cannot be read', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { orderId: 'o1', items: [{ sku: 'A', qty: 1 }] } });
    // TransactionCanceledException with no CancellationReasons field.
    ddbMock
      .on(TransactWriteCommand)
      .rejects(Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }));

    await expect(handler({ orderId: 'o1' })).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
  });

  it('rethrows unexpected transaction errors', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { orderId: 'o1', items: [{ sku: 'A', qty: 1 }] } });
    ddbMock.on(TransactWriteCommand).rejects(new Error('boom'));

    await expect(handler({ orderId: 'o1' })).rejects.toThrow('boom');
  });

});