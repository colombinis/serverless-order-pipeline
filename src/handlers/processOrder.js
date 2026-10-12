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
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      const { orderId } = JSON.parse(record.body);

      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn: process.env.STATE_MACHINE_ARN,
          name: `order-${orderId}`,
          input: JSON.stringify({ orderId }),
        })
      );
    } catch (err) {
      // A closed execution with the same name already fulfilled this order:
      // it is a no-op, NOT a failure. Do not report it, or SQS would retry forever.
      if (err?.name === 'ExecutionAlreadyExists') {
        console.log(`Execution already exists for order — skipping duplicate`);
        continue;
      }
      // Real failure: report ONLY this record so the rest of the batch is not retried.
      console.error(JSON.stringify({ level: 'error', messageId: record.messageId, error: err.message }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};