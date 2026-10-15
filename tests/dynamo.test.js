/**
 * src/lib/dynamo.js reads its configuration ONCE, when the module is first
 * loaded, so the only way to exercise both sides of its endpoint fallback is to
 * load it again with a different environment. jest.isolateModules() resets the
 * module registry for that (note: it also re-creates the AWS SDK classes, but
 * these tests never send a command, so no mocks are needed).
 *
 * process.env is process-wide, so the controlled variables are restored as soon
 * as the module has been evaluated (the endpoint is captured at construction).
 */
const RESTORED = ['AWS_ENDPOINT_URL', 'IS_OFFLINE'];

const loadDynamoWith = (env) => {
  const saved = Object.fromEntries(RESTORED.map((key) => [key, process.env[key]]));

  RESTORED.forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);

  let mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require('../src/lib/dynamo');
  });

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return mod;
};

describe('dynamo client endpoint resolution', () => {
  it('uses AWS_ENDPOINT_URL when set (MiniStack / LocalStack)', async () => {
    const { docClient } = loadDynamoWith({ AWS_ENDPOINT_URL: 'http://ministack:4566' });

    await expect(docClient.config.endpoint()).resolves.toMatchObject({
      hostname: 'ministack',
      port: 4566,
      protocol: 'http:',
    });
  });

  it('prefers AWS_ENDPOINT_URL over IS_OFFLINE when both are set', async () => {
    const { docClient } = loadDynamoWith({
      AWS_ENDPOINT_URL: 'http://ministack:4566',
      IS_OFFLINE: '1',
    });

    await expect(docClient.config.endpoint()).resolves.toMatchObject({ hostname: 'ministack' });
  });

  it('falls back to the DynamoDB Local port when only IS_OFFLINE is set', async () => {
    const { docClient } = loadDynamoWith({ IS_OFFLINE: '1' });

    await expect(docClient.config.endpoint()).resolves.toMatchObject({
      hostname: 'localhost',
      port: 8000,
      protocol: 'http:',
    });
  });

  it('leaves the endpoint unset (real AWS) when neither is configured', () => {
    const { docClient } = loadDynamoWith({});

    expect(docClient.config.endpoint).toBeUndefined();
  });
});
