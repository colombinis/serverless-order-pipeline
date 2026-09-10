const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { getOrder } = require('../lib/orders');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Step Functions Task. Input: { orderId }
 * Final success step: publishes a confirmation notification.
 * Subscribe an email or another Lambda to OrderNotificationsTopic to see it.
 */
module.exports.handler = async ({ orderId }) => {
  const order = await getOrder(orderId);

  await snsClient.send(
    new PublishCommand({
      TopicArn: process.env.NOTIFICATIONS_TOPIC_ARN,
      Subject: `Order ${orderId} confirmed`,
      Message: `Your order ${orderId} for customer ${order.customerId} has been confirmed.`,
    })
  );

  return { orderId, status: 'CONFIRMED' };
};
