const { Logger } = require('@aws-lambda-powertools/logger');
const { Metrics, MetricUnit } = require('@aws-lambda-powertools/metrics');
const { Tracer } = require('@aws-lambda-powertools/tracer');

const serviceName = process.env.POWERTOOLS_SERVICE_NAME || 'order-pipeline';

const logger = new Logger({ serviceName });
const metrics = new Metrics({
  namespace: process.env.POWERTOOLS_METRICS_NAMESPACE || 'OrderPipeline',
  serviceName,
});
const tracer = new Tracer({ serviceName });

module.exports = { logger, metrics, tracer, MetricUnit };