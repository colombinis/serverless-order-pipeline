const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const sfnMock = mockClient(SFNClient);

process.env.STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfillment';
process.env.AWS_REGION = 'us-east-1';

const { handler } = require('../src/handlers/processOrder');

describe('processOrder handler (idempotent consumer)', () => {
  beforeEach(() => {
    sfnMock.reset();
  });

  it('starts the execution with a deterministic name (no timestamp)', async () => {
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:exec', startDate: new Date() });

    await handler({ Records: [{ body: JSON.stringify({ orderId: 'ord-abc' }) }] });

    expect(sfnMock).toHaveReceivedCommandWith(StartExecutionCommand, {
      stateMachineArn: process.env.STATE_MACHINE_ARN,
      name: 'order-ord-abc',
      input: JSON.stringify({ orderId: 'ord-abc' }),
    });
  });

  it('uses the SAME execution name for two redeliveries of the same order', async () => {
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:exec', startDate: new Date() });

    const record = { body: JSON.stringify({ orderId: 'ord-abc' }) };
    await handler({ Records: [record] });
    await handler({ Records: [record] });

    expect(sfnMock).toHaveReceivedCommandTimes(StartExecutionCommand, 2);
    const calls = sfnMock.commandCalls(StartExecutionCommand);
    expect(calls[0].args[0].input.name).toBe(calls[1].args[0].input.name);
    expect(calls[0].args[0].input.name).toBe('order-ord-abc');
  });

  it('swallows ExecutionAlreadyExists (closed execution, duplicate redelivery)', async () => {
    sfnMock
      .on(StartExecutionCommand)
      .rejectsOnce(
        Object.assign(new Error('ExecutionAlreadyExists'), { name: 'ExecutionAlreadyExists' })
      )
      .resolves({ executionArn: 'arn:exec', startDate: new Date() });

    // Must not throw: the duplicate is a no-op, the batch must not fail forever.
    await expect(
      handler({ Records: [{ body: JSON.stringify({ orderId: 'ord-closed' }) }] })
    ).resolves.toBeUndefined();

    // And the next (different) order still starts normally.
    await handler({ Records: [{ body: JSON.stringify({ orderId: 'ord-new' }) }] });
    expect(sfnMock).toHaveReceivedCommandTimes(StartExecutionCommand, 2);
  });
});