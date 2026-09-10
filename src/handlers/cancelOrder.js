const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { updateOrderStatus } = require('../lib/orders');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Step Functions Task. Reached via `Catch` from any earlier step.
 * Input includes the original payload plus an `error` field added by
 * the state machine's ResultPath.
 */
module.exports.handler = async ({ orderId, error }) => {
  await updateOrderStatus(orderId, 'CANCELLED', {
    cancelReason: error?.Cause || 'Unknown error',
  });

  await snsClient.send(
    new PublishCommand({
      TopicArn: process.env.NOTIFICATIONS_TOPIC_ARN,
      Subject: `Order ${orderId} cancelled`,
      Message: `Order ${orderId} could not be fulfilled and was cancelled.`,
    })
  );

  return { orderId, status: 'CANCELLED' };
};
