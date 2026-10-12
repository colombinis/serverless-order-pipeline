#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const HANDLER_DIR = path.join(__dirname, '..', 'src', 'handlers');

const HANDLER_KINDS = {
  createOrder: 'api',
  processOrder: 'sqs',
};

const DEFAULT_PAYLOADS = {
  createOrder: { customerId: 'local-user', items: [{ sku: 'ABC', qty: 2 }] },
  processOrder: { orderId: 'local-invoke-order' },
  validateStock: { orderId: 'local-invoke-order' },
  reserveInventory: { orderId: 'local-invoke-order' },
  chargePayment: { orderId: 'local-invoke-order' },
  confirmOrder: { orderId: 'local-invoke-order' },
  notifyCustomer: { orderId: 'local-invoke-order' },
  cancelOrder: { orderId: 'local-invoke-order' },
};

const DEFAULT_ENV = {
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: '123456789012',
  AWS_SECRET_ACCESS_KEY: 'test',
  ORDERS_TABLE: 'serverless-order-pipeline-orders-dev',
  ORDER_QUEUE_URL: 'http://localhost:4566/123456789012/serverless-order-pipeline-order-queue-dev',
  NOTIFICATIONS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:serverless-order-pipeline-notifications-dev',
  STATE_MACHINE_ARN: 'arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfillmentStateMachine',
};

function usage(exitCode = 0) {
  console.error(`Uso:
  node scripts/local-invoke.js <handler> [payload-json | --body '<json>'] [--event-file ruta.json] [--print]

  - handler:     createOrder | processOrder | validateStock | reserveInventory
                 | chargePayment | confirmOrder | notifyCustomer | cancelOrder
  - payload-json: payload del evento (por defecto usa uno por handler)
  - --body '<json>':  payload para handlers de tipo API/SQS (se wrappea a 'event.body' /
                 a 'event.Records[].body' cuando corresponde)
  - --event-file: leer el payload desde un archivo JSON
  - --print:      imprimir el env que se usa

Ejemplos:
  node scripts/local-invoke.js createOrder
  node scripts/local-invoke.js validateStock --body '{"orderId":"abc"}'
  node scripts/local-invoke.js processOrder --body '{"orderId":"abc"}'

Apuntan a MiniStack (http://localhost:4566) y usan los mismos nombres de
recursos que scripts/ministack-bootstrap.sh. El handler corre como proceso
Node local (sin contenedor de Lambda), ideal para debuggear con breakpoints.
`);
  process.exit(exitCode);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') usage();

  const handler = args[0];
  if (!fs.existsSync(path.join(HANDLER_DIR, `${handler}.js`))) {
    console.error(`Handler no encontrado: ${handler}`);
    usage(1);
  }

  const opts = { payload: null, print: false };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--body') {
      opts.payload = JSON.parse(args[++i]);
    } else if (args[i] === '--event-file') {
      opts.payload = JSON.parse(fs.readFileSync(args[++i], 'utf8'));
    } else if (args[i] === '--print') {
      opts.print = true;
    } else if (args[i].startsWith('{')) {
      opts.payload = JSON.parse(args[i]);
    } else {
      usage(1);
    }
  }
  return { handler, ...opts };
}

function buildEvent(handler, payload) {
  const kind = HANDLER_KINDS[handler] || 'sfn';
  if (kind === 'api') {
    return { body: JSON.stringify(payload) };
  }
  if (kind === 'sqs') {
    return { Records: [{ body: JSON.stringify(payload) }] };
  }
  return payload;
}

async function main() {
  const { handler, payload, print } = parseArgs();

  Object.entries(DEFAULT_ENV).forEach(([k, v]) => {
    process.env[k] ??= v;
  });
  if (print) {
    console.log('env:', JSON.stringify(DEFAULT_ENV, null, 2));
  }

  const resolvedPayload = payload ?? DEFAULT_PAYLOADS[handler];
  const event = buildEvent(handler, resolvedPayload);

  console.log(`==> Invocando ${handler}.handler en proceso (sin emulador de Lambda)`);
  console.log('    event:', JSON.stringify(event, null, 2));

  const { handler: fn } = require(path.join(HANDLER_DIR, handler));
  const result = await fn(event);

  if (typeof result?.statusCode === 'number') {
    console.log(`<== HTTP ${result.statusCode}`);
    console.log('    body:', result.body);
  } else {
    console.log('<== resultado:', JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  // Se imprime el stack para que el debugger se detenga acá también
  console.error('ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});