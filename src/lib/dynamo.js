const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// Reused across warm Lambda invocations - avoid creating a new client per call
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  // Allows pointing to DynamoDB Local during `serverless offline start`
  ...(process.env.IS_OFFLINE && {
    endpoint: 'http://localhost:8000',
  }),
});

const docClient = DynamoDBDocumentClient.from(client);

module.exports = { docClient };
