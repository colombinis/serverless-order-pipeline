const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// Reused across warm Lambda invocations - avoid creating a new client per call
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  // Priority:
  //  1. AWS_ENDPOINT_URL (MiniStack / LocalStack emulation, e.g. http://ministack:4566)
  //  2. DynamoDB Local port when IS_OFFLINE is set without an endpoint override
  //  3. default (real AWS)
  endpoint:
    process.env.AWS_ENDPOINT_URL ||
    (process.env.IS_OFFLINE ? 'http://localhost:8000' : undefined),
});

const docClient = DynamoDBDocumentClient.from(client);

module.exports = { docClient };
