// Keep the test runner output clean: assert on behavior, not on log noise.
process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
process.env.POWERTOOLS_TRACE_ENABLED = 'false';