const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * SQS-triggered handler.
 * Decouples "an order was created" from "run the fulfillment workflow" -
 * this is the async processing pattern the JD calls out explicitly.
 */
module.exports.handler = async (event) => {
  for (const record of event.Records) {
    const { orderId } = JSON.parse(record.body);

    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: process.env.STATE_MACHINE_ARN,
        name: `order-${orderId}-${Date.now()}`,
        input: JSON.stringify({ orderId }),
      })
    );
  }
};
