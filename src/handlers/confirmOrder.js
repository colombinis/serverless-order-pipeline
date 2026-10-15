const { updateOrderStatus } = require('../lib/orders');
const { logger, metrics, MetricUnit } = require('../lib/observability');

/**
 * Step Functions Task. Input: { orderId }
 * Marks the order as confirmed once stock, inventory and payment
 * have all succeeded.
 */
module.exports.handler = async ({ orderId }) => {
  await updateOrderStatus(orderId, 'CONFIRMED');
  logger.info('Order confirmed', { orderId });
  metrics.addMetric('OrderConfirmed', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();
  return { orderId };
};
