const { getOrder, updateOrderStatus } = require('../lib/orders');

/**
 * Step Functions Task. Input: { orderId }
 * Simulates a stock check. In a real system this would call an
 * inventory service or query a stock table.
 *
 * Throwing here is intentional: it lets the state machine's `Catch`
 * route the execution to CancelOrder without extra branching logic here.
 */
module.exports.handler = async ({ orderId }) => {
  const order = await getOrder(orderId);

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const outOfStock = order.items.some((item) => item.qty > 100);

  if (outOfStock) {
    throw new Error(`Insufficient stock for order ${orderId}`);
  }

  await updateOrderStatus(orderId, 'STOCK_VALIDATED');

  return { orderId };
};
