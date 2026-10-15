const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
const { logger, tracer } = require('../lib/observability');
const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });
tracer.captureAWSv3Client(sfnClient);

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
    let orderId;
    try {
      ({ orderId } = JSON.parse(record.body));

      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn: process.env.STATE_MACHINE_ARN,
          name: `order-${orderId}`,
          input: JSON.stringify({ orderId }),
        })
      );
      logger.info('Workflow started', { orderId });
    } catch (err) {
      // A closed execution with the same name already fulfilled this order:
      // it is a no-op, NOT a failure. Do not report it, or SQS would retry forever.
      if (err?.name === 'ExecutionAlreadyExists') {
        logger.info('Duplicate event skipped (execution already exists)', { orderId });
        continue;
      }
      // Real failure: report ONLY this record so the rest of the batch is not retried.
      logger.error('Failed to start workflow', { messageId: record.messageId, error: err.message });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};