const { updateOrderStatus } = require('../lib/orders');

/**
 * Step Functions Task. Input: { orderId }
 * Marks the order as confirmed once stock, inventory and payment
 * have all succeeded.
 */
module.exports.handler = async ({ orderId }) => {
  await updateOrderStatus(orderId, 'CONFIRMED');
  return { orderId };
};
