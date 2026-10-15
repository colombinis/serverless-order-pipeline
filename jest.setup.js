// Keep the test runner output clean: assert on behavior, not on log noise.
process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
process.env.POWERTOOLS_TRACE_ENABLED = 'false';
process.env.AWS_ENDPOINT_URL ??= 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';