function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

// RFC 9457 problem details: the standard error shape for this API.
// Replaces the previous ad-hoc `{ message }` payloads.
function problem(statusCode, title, detail) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/problem+json' },
    body: JSON.stringify({ type: 'about:blank', title, status: statusCode, detail }),
  };
}

module.exports = { response, problem };
