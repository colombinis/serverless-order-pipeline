const { getOrder: fetchOrder } = require('../lib/orders');
const { response, problem } = require('../lib/response');

/**
 * GET /orders/{orderId}
 * Read side of the contract. Returns the current order state, or 404
 * (RFC 9457 problem+json) when the order does not exist.
 */
module.exports.handler = async (event) => {
  const orderId = event?.pathParameters?.orderId;

  if (!orderId) {
    return problem(400, 'Missing orderId', 'The orderId path parameter is required.');
  }

  const order = await fetchOrder(orderId);
  if (!order) {
    return problem(404, 'Order not found', `No order with id ${orderId} was found.`);
  }

  return response(200, order);
};
