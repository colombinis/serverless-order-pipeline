const { updateOrderStatus } = require('../lib/orders');

/**
 * Step Functions Task. Input: { orderId }
 * Simulates a payment charge. Swap this for a real payment
 * provider call (Stripe, MercadoPago, etc.) when needed.
 */
module.exports.handler = async ({ orderId }) => {
  await updateOrderStatus(orderId, 'PAYMENT_CHARGED');
  return { orderId };
};
