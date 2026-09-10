const { updateOrderStatus } = require('../lib/orders');

/**
 * Step Functions Task. Input: { orderId }
 * Simulates reserving inventory (decrementing a stock counter).
 */
module.exports.handler = async ({ orderId }) => {
  await updateOrderStatus(orderId, 'INVENTORY_RESERVED');
  return { orderId };
};
