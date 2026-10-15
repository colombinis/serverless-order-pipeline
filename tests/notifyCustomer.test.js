const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const snsMock = mockClient(SNSClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

process.env.ORDERS_TABLE = 'test-orders-table';
process.env.NOTIFICATIONS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
// Deterministic: the fallback must apply even if the shell exports AWS_REGION.
delete process.env.AWS_REGION;

const { handler } = require('../src/handlers/notifyCustomer');

const resolvedRegionOfLastPublish = async () => snsMock.calls()[0].thisValue.config.region();

describe('notifyCustomer handler', () => {
  beforeEach(() => {
    snsMock.reset();
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({
      Item: { orderId: 'o-1', customerId: 'c-1', status: 'CONFIRMED' },
    });
    snsMock.on(PublishCommand).resolves({});
  });

  it('publishes the confirmation for the order owner and reports CONFIRMED', async () => {
    const result = await handler({ orderId: 'o-1' });

    expect(result).toEqual({ orderId: 'o-1', status: 'CONFIRMED' });
    expect(ddbMock).toHaveReceivedCommandWith(GetCommand, {
      TableName: 'test-orders-table',
      Key: { orderId: 'o-1' },
    });
    expect(snsMock).toHaveReceivedCommandWith(PublishCommand, {
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
      Subject: 'Order o-1 confirmed',
      Message: 'Your order o-1 for customer c-1 has been confirmed.',
    });
  });

  it('falls back to us-east-1 when AWS_REGION is not set', async () => {
    await handler({ orderId: 'o-1' });

    expect(snsMock).toHaveReceivedCommand(PublishCommand);
    await expect(resolvedRegionOfLastPublish()).resolves.toBe('us-east-1');
  });

  it('honours AWS_REGION when it is set (the client is built at module load)', async () => {
    process.env.AWS_REGION = 'eu-west-1';

    // The region is read once, at import time, so this branch needs a second
    // load of the module. jest.isolateModules() gives a fresh registry -- and
    // that registry ALSO re-creates the AWS SDK classes, so the mocks above no
    // longer intercept them: an unmocked client would reach the real DynamoDB
    // endpoint (and fail on credentials). Mock the fresh classes instead.
    let isolatedHandler;
    let isolatedSnsMock;
    jest.isolateModules(() => {
      const sns = require('@aws-sdk/client-sns');
      const ddb = require('@aws-sdk/lib-dynamodb');

      isolatedSnsMock = mockClient(sns.SNSClient);
      mockClient(ddb.DynamoDBDocumentClient)
        .on(ddb.GetCommand)
        .resolves({ Item: { orderId: 'o-1', customerId: 'c-1', status: 'CONFIRMED' } });
      isolatedSnsMock.on(sns.PublishCommand).resolves({});

      isolatedHandler = require('../src/handlers/notifyCustomer');
    });
    delete process.env.AWS_REGION;

    await isolatedHandler.handler({ orderId: 'o-1' });

    // Asserted through calls() rather than the matcher: the PublishCommand class
    // inside the isolated registry is a different object, so the matcher (which
    // is bound to the class loaded above) would not recognise it.
    expect(isolatedSnsMock.calls()).toHaveLength(1);
    expect(isolatedSnsMock.calls()[0].args[0].input.Subject).toBe('Order o-1 confirmed');
    await expect(isolatedSnsMock.calls()[0].thisValue.config.region()).resolves.toBe('eu-west-1');
  });
});
