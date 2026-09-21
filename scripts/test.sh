#!/usr/bin/env bash
# test.sh
# Prueba TEMPORAL contra MiniStack (sin Serverless Framework):
#  1. API Gateway v1 real vía CLI con la ruta GET /saludo/{nombre}
#  2. Crear la Lambda `saludo` (recibe nombre opcional por pathParameter)
#  3. Conectar la ruta del API Gateway con la Lambda (integración AWS_PROXY)
#  4. Validar que la ejecución quede logueada en CloudWatch Logs con el
#     parámetro recibido.
#
# MiniStack emula API Gateway v1 (REST) y v2 (HTTP). Una API REST v1 se invoca
# con la ruta interna `_user_request_`:
#   http://localhost:4566/restapis/{apiId}/{stage}/_user_request_/{path}
# Las ejecuciones de Lambda escriben logs en el log group /aws/lambda/{fn}
# (creado automáticamente por MiniStack).
#
# Uso:
#   scripts/test.sh                # crea, prueba y ELIMINA todo al terminar
#   KEEP_API=1 scripts/test.sh     # conserva API + Lambda para inspección
#   SMOKE=0 scripts/test.sh        # omite la verificación final en CloudWatch
set -euo pipefail

EP="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="${MINISTACK_ACCOUNT_ID:-123456789012}"
KEEP_API="${KEEP_API:-1}"
SMOKE="${SMOKE:-1}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STAGE="test"
API_NAME="test-saludo-$(date +%s)"
LAMBDA_FN="saludo"
LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT}:function:${LAMBDA_FN}"
INTEG_URI="arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations"
LOG_GROUP="/aws/lambda/${LAMBDA_FN}"

a() { aws --endpoint-url "$EP" "$@"; }

info(){ echo -e "\033[1;34m== $*\033[0m"; }
ok(){ echo -e "\033[1;32m   $*\033[0m"; }
warn(){ echo -e "\033[1;33m   ! $*\033[0m"; }
fail(){ echo -e "\033[1;31m   ✗ $*\033[0m"; }

API_ID=""

cleanup() {
  if [[ "$KEEP_API" == "1" ]]; then
    info "KEEP_API=1: conservando API id=${API_ID} y Lambda ${LAMBDA_FN}"
    return
  fi
  if [[ -n "$API_ID" ]]; then
    info "Limpiando: delete-rest-api ${API_ID}"
    a apigateway delete-rest-api --rest-api-id "$API_ID" >/dev/null 2>&1 && ok "API eliminada"
  fi
  info "Limpiando: delete-function ${LAMBDA_FN}"
  a lambda delete-function --function-name "$LAMBDA_FN" >/dev/null 2>&1 && ok "Lambda eliminada"
}

trap cleanup EXIT

# 0. Precondición
info "Health check MiniStack"
a sts get-caller-identity >/dev/null 2>&1 || { fail "MiniStack no responde en ${EP}"; exit 1; }
ok "conexión OK"

# 2. Crear la Lambda `saludo(string? nombre)` — el ? indica que es opcional:
#    si no viene el pathParameter, responde con "mundo"
info "Creando Lambda ${LAMBDA_FN} (runtime ${RUNTIME:-nodejs18.x})"
MKDIR="/tmp/lambda-saludo"
rm -rf "$MKDIR"
mkdir -p "$MKDIR"
cat >"$MKDIR/saludo.js" <<'EOF'
module.exports.handler = async (event) => {
  const nombre = (event.pathParameters && event.pathParameters.nombre) || 'mundo';
  console.log('saludo recibido:', nombre);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje: `Hola, ${nombre}!` }),
  };
};
EOF
( cd "$MKDIR" && zip -q saludo.zip saludo.js )
if a lambda list-functions --query 'Functions[].FunctionName' --output text | grep -qw "$LAMBDA_FN"; then
  warn "ya existía — se recrea igual (borra + crea)"
  a lambda delete-function --function-name "$LAMBDA_FN" >/dev/null 2>&1 || true
fi
a lambda create-function \
  --function-name "$LAMBDA_FN" \
  --runtime nodejs18.x \
  --role "arn:aws:iam::${ACCOUNT}:role/lambda-test" \
  --handler "saludo.handler" \
  --zip-file "fileb://${MKDIR}/saludo.zip" >/dev/null
rm -rf "$MKDIR"
ok "Lambda creada"

# 1. Crear la REST API
info "create-rest-api ${API_NAME}"
API_ID=$(a apigateway create-rest-api \
  --name "$API_NAME" \
  --description "test temporal (saludo) — se elimina al terminar" \
  --query 'id' --output text)
ok "API ID: ${API_ID}"

# Ruta /saludo/{nombre}
ROOT_ID=$(a apigateway get-resources --rest-api-id "$API_ID" \
  --query 'items[?path==`/`].id' --output text)
SALUDO_ID=$(a apigateway create-resource \
  --rest-api-id "$API_ID" --parent-id "$ROOT_ID" --path-part 'saludo' \
  --query 'id' --output text)
NOMBRE_ID=$(a apigateway create-resource \
  --rest-api-id "$API_ID" --parent-id "$SALUDO_ID" --path-part '{nombre}' \
  --query 'id' --output text)
ok "resource /saludo/{nombre} = ${NOMBRE_ID}"

info "put-method GET /saludo/{nombre}"
a apigateway put-method \
  --rest-api-id "$API_ID" \
  --resource-id "$NOMBRE_ID" \
  --http-method GET \
  --authorization-type NONE \
  --request-parameters '{"method.request.path.nombre": true}' >/dev/null
ok "método configurado"

# 3. Conectar la ruta con la Lambda (AWS_PROXY: passthrough, la Lambda recibe
#    pathParameters en el event)
info "put-integration AWS_PROXY -> ${LAMBDA_FN}"
RESP=$(a apigateway put-integration \
  --rest-api-id "$API_ID" \
  --resource-id "$NOMBRE_ID" \
  --http-method GET \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "$INTEG_URI" \
  --content-handling CONVERT_TO_TEXT 2>&1) || {
  fail "put-integration falló: ${RESP}"
  exit 1
}
ok "integración creada"

info "create-deployment + stage ${STAGE}"
a apigateway create-deployment --rest-api-id "$API_ID" --stage-name "$STAGE" >/dev/null
ok "desplegada"

# Smoke test: GET /saludo/{nombre} por la ruta interna de MiniStack
if [[ "$SMOKE" == "1" ]]; then
  URL="${EP}/restapis/${API_ID}/${STAGE}/_user_request_/saludo/Pepito"
  info "GET ${URL}"
  HTTP_OUT=$(curl -s -w '\n%{http_code}' "$URL")
  BODY_OUT=$(echo "$HTTP_OUT" | head -n -1)
  HTTP_CODE=$(echo "$HTTP_OUT" | tail -n1)
  if [[ "$HTTP_CODE" == "200" ]] && echo "$BODY_OUT" | grep -q "Hola, Pepito"; then
    ok "HTTP 200: ${BODY_OUT}"
  else
    fail "HTTP ${HTTP_CODE}: ${BODY_OUT} (esperado Hola, Pepito)"
  fi

  # 4. Verificar en CloudWatch Logs que la ejecución quedó con el parámetro
  sleep 2
  info "CloudWatch Logs ${LOG_GROUP}"
  HITS=$(a logs filter-log-events \
    --log-group-name "$LOG_GROUP" \
    --filter-pattern '"saludo recibido: Pepito"' \
    --query 'events[].message' --output text 2>&1)
  if echo "$HITS" | grep -q "saludo recibido: Pepito"; then
    ok "log encontrado: ${HITS}"
  else
    fail "no apareció el log 'saludo recibido: Pepito' en ${LOG_GROUP}"
    warn "log groups disponibles:"
    a logs describe-log-groups --query 'logGroups[].logGroupName' --output text
  fi
fi

info "Test temporal completado."
if [[ "$KEEP_API" == "1" ]]; then
  echo "   API conservada: http://localhost:4566/restapis/${API_ID}/${STAGE}/_user_request_/saludo/{nombre}"
else
  echo "   API + Lambda de prueba eliminadas."
fi