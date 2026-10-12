const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * SQS-triggered handler.
 * Decouples "an order was created" from "run the fulfillment workflow" -
 * this is the async processing pattern the JD calls out explicitly.
 *
 * Idempotent consumer (lesson 5, cure C):
 * - DETERMINISTIC execution name (`order-${orderId}`, no Date.now()): StartExecution
 *   is idempotent for STANDARD workflows while the execution is running, so an SQS
 *   redelivery (at-least-once) reuses the running execution instead of double-charging.
 * - ExecutionAlreadyExists is swallowed: if the execution already CLOSED (SUCCEEDED/
 *   FAILED) and the message is redelivered, we skip instead of failing forever.
 */
module.exports.handler = async (event) => {
  for (const record of event.Records) {
    const { orderId } = JSON.parse(record.body);

    try {
      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn: process.env.STATE_MACHINE_ARN,
          name: `order-${orderId}`,
          input: JSON.stringify({ orderId }),
        })
      );
    } catch (err) {
      // A closed execution with the same name+input already fulfilled this order.
      // The duplicate redelivery must not fail the batch forever.
      if (err?.name === 'ExecutionAlreadyExists') {
        console.log(`Execution already exists for order ${orderId} — skipping duplicate`);
        continue;
      }
      throw err;
    }
  }
};