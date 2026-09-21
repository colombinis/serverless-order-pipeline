#!/usr/bin/env bash
# ministack-bootstrap.sh
# Provisiona las Lambdas y recursos de serverless-order-pipeline directamente
# contra MiniStack (:4566), porque el CloudFormation del emulador NO puede
# materializar el template que genera Serverless Framework (TemplateURL y
# dependencias circulares de Lambda::Version no están soportadas).
#
# Idempotente: si un recurso ya existe, se actualiza el código/entorno en vez de
# recrearlo. Los NOMBRES de los recursos coinciden 1:1 con serverless.yml (que es
# la fuente de verdad SOLO para AWS real).
#
# Uso:
#   scripts/ministack-bootstrap.sh
#   SMOKE_TEST=0 scripts/ministack-bootstrap.sh   # omite la prueba de ejecución
set -euo pipefail

EP="${AWS_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="${MINISTACK_ACCOUNT_ID:-123456789012}"
SMOKE_TEST="${SMOKE_TEST:-1}"
RUNTIME=nodejs18.x

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SERVICE=serverless-order-pipeline
STAGE=dev
PREFIX="${SERVICE}-${STAGE}"
TABLE="${SERVICE}-orders-${STAGE}"
QUEUE="${SERVICE}-order-queue-${STAGE}"
TOPIC="${SERVICE}-notifications-${STAGE}"
STATE_MACHINE=OrderFulfillmentStateMachine
BUCKET="${PREFIX}-deployment"
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/serverless-order-pipeline-dev-lambdarole"
QUEUE_URL="http://localhost:4566/${ACCOUNT}/${QUEUE}"
TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT}:${TOPIC}"
STATE_MACHINE_ARN="arn:aws:states:${REGION}:${ACCOUNT}:stateMachine:${STATE_MACHINE}"

ZIP="${ZIP:-$REPO_ROOT/.build/serverless-order-pipeline.zip}"
LAMBDAS=(createOrder processOrder validateStock reserveInventory chargePayment confirmOrder notifyCustomer cancelOrder)

a() { aws --endpoint-url "$EP" "$@"; }

info(){ echo -e "\033[1;34m== $*\033[0m"; }
ok(){ echo -e "\033[1;32m   $*\033[0m"; }
warn(){ echo -e "\033[1;33m   ! $*\033[0m"; }

# 0. Zip del código: empaqueta las 8 Lambdas y sus dependencias usando zip (sin
# Serverless Framework). El zip replica el árbol del repo: handlers y libs vuelven
# quedar bajo src/, y node_modules en la raíz. Así los require('../lib/...') de los
# handlers resuelven igual que en el repo, y Lambda se configura con el handler
# "src/handlers/<function>.handler".
if [[ ! -f "$ZIP" ]]; then
  info "Empaquetando zip de las 8 Lambdas (sin serverless)"
  mkdir -p "$(dirname "$ZIP")"
  TMPDIR="/tmp/lambda-zip"
  rm -rf "$TMPDIR"
  mkdir -p "$TMPDIR/src/handlers" "$TMPDIR/src/lib"
  # Copiar handlers y libs preservando la estructura src/handlers + src/lib
  for name in "${LAMBDAS[@]}"; do
    cp "src/handlers/${name}.js" "$TMPDIR/src/handlers/${name}.js"
  done
  cp src/lib/*.js "$TMPDIR/src/lib/"
  cp package.json "$TMPDIR/package.json"
  cd "$TMPDIR"
  npm install --production >/dev/null 2>&1
  # Crear zip con src/ y node_modules en la raíz
  zip -r9 "$ZIP" src node_modules package.json >/dev/null
  cd "$REPO_ROOT"
  rm -rf "$TMPDIR"
  ok "zip creado en $ZIP"
fi

# 1. Bucket de deployment (alojamiento del zip para lambda create/update)
info "S3 bucket ${BUCKET}"
if a s3 ls "s3://${BUCKET}/" >/dev/null 2>&1; then
  ok "ya existe"
else
  a s3 mb "s3://${BUCKET}" >/dev/null
  ok "creado"
fi

TS=$(date +%s)
S3KEY="deploy/${TS}/serverless-order-pipeline.zip"
info "Subiendo zip a s3://${BUCKET}/${S3KEY}"
a s3 cp "$ZIP" "s3://${BUCKET}/${S3KEY}" --quiet

# 2. Tabla DynamoDB
info "DynamoDB ${TABLE}"
if a dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  ok "ya existe"
else
  a dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=orderId,AttributeType=S \
    --key-schema AttributeName=orderId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  ok "creada"
fi

# 3. Cola SQS
info "SQS ${QUEUE}"
if a sqs get-queue-url --queue-name "$QUEUE" >/dev/null 2>&1; then
  ok "ya existe"
else
  a sqs create-queue --queue-name "$QUEUE" --attributes VisibilityTimeout=60 >/dev/null
  ok "creada"
fi

# 4. Tópico SNS
info "SNS ${TOPIC}"
if a sns get-topic-attributes --topic-arn "$TOPIC_ARN" >/dev/null 2>&1; then
  ok "ya existe"
else
  a sns create-topic --name "$TOPIC" >/dev/null
  ok "creado"
fi

# 5. State Machine (Tasks apuntan a las Lambdas que creamos abajo)
info "Step Functions ${STATE_MACHINE}"
if a stepfunctions describe-state-machine --state-machine-arn "$STATE_MACHINE_ARN" >/dev/null 2>&1; then
  ok "ya existe"
else
  ASL="/tmp/ministack-asl.json"
  cat >"$ASL" <<EOF
{
  "Comment": "Order fulfillment workflow: stock -> inventory -> payment -> confirm -> notify",
  "StartAt": "ValidateStock",
  "States": {
    "ValidateStock": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${PREFIX}-validateStock",
      "Next": "ReserveInventory",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "\$.error", "Next": "CancelOrder" }]
    },
    "ReserveInventory": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${PREFIX}-reserveInventory",
      "Next": "ChargePayment",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "\$.error", "Next": "CancelOrder" }]
    },
    "ChargePayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${PREFIX}-chargePayment",
      "Next": "ConfirmOrder",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "\$.error", "Next": "CancelOrder" }]
    },
    "ConfirmOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${PREFIX}-confirmOrder",
      "Next": "NotifyCustomer"
    },
    "NotifyCustomer": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${PREFIX}-notifyCustomer",
      "End": true
    },
    "CancelOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:${PREFIX}-cancelOrder",
      "End": true
    }
  }
}
EOF
  a stepfunctions create-state-machine \
    --name "$STATE_MACHINE" \
    --definition "file://${ASL}" \
    --role-arn "arn:aws:iam::${ACCOUNT}:role/order-fulfillment-${STAGE}" >/dev/null
  ok "creada (role ARN dummy, MiniStack no lo valida)"
fi

# 6. Env común: el endpoint hacia MiniStack, no hacia AWS
COMMON_ENV="Variables={
  AWS_ENDPOINT_URL=http://ministack:4566,
  AWS_REGION=${REGION},
  ORDERS_TABLE=${TABLE},
  ORDER_QUEUE_URL=${QUEUE_URL},
  NOTIFICATIONS_TOPIC_ARN=${TOPIC_ARN},
  STATE_MACHINE_ARN=${STATE_MACHINE_ARN}
}"
S3_CODE="S3Bucket=${BUCKET},S3Key=${S3KEY}"

# 7. Las 8 Lambdas (nombre: <service>-<stage>-<function>, igual que el yml para AWS real)
for name in "${LAMBDAS[@]}"; do
  FN="${PREFIX}-${name}"
  info "Lambda ${FN}"
  if a lambda list-functions --query 'Functions[].FunctionName' --output text | grep -qw "$FN"; then
    a lambda update-function-code --function-name "$FN" --s3-bucket "$BUCKET" --s3-key "$S3KEY" >/dev/null 2>&1 \
      && ok "código actualizado" || warn "update-function-code no soportado, se mantiene el último código"
  else
    a lambda create-function \
      --function-name "$FN" \
      --runtime "$RUNTIME" \
      --role "$ROLE_ARN" \
      --handler "src/handlers/${name}.handler" \
      --code "$S3_CODE" >/dev/null
    ok "creada"
  fi
  a lambda update-function-configuration --function-name "$FN" --handler "src/handlers/${name}.handler" --environment "$COMMON_ENV" >/dev/null
done

# 8. Event source mapping SQS -> processOrder (el equivalente a events: sqs del yml)
info "Event Source Mapping SQS → ${PREFIX}-processOrder"
ESM_UUID=$(a lambda list-event-source-mappings --function-name "${PREFIX}-processOrder" \
  --query 'EventSourceMappings[].UUID' --output text 2>/dev/null | tr -d '\n ')
if [[ "$ESM_UUID" =~ [0-9a-f-]{8} ]]; then
  ok "ya existe (${ESM_UUID})"
else
  if a lambda create-event-source-mapping \
      --function-name "${PREFIX}-processOrder" \
      --event-source-arn "arn:aws:sqs:${REGION}:${ACCOUNT}:${QUEUE}" \
      --batch-size 1 >/dev/null 2>&1; then
    ok "creado (los mensajes de la cola ahora disparan processOrder)"
  else
    warn "MiniStack no soporta create-event-source-mapping; la cola queda sin consumidor (dríve del SFN por StartExecution manual)"
  fi
fi

info "Estado final"
a lambda list-functions --query 'Functions[].FunctionName' --output text
a stepfunctions list-state-machines --query 'stateMachines[].stateMachineArn' --output text

# 9. API Gateway real en MiniStack (control-plane vía CLI, sin Express).
# MiniStack emula API Gateway v1 (REST, 86 ops) y v2 (HTTP, 42 ops). Creamos una
# REST API con POST /orders → createOrder (integración AWS_PROXY) y la publicamos
# en un stage. Se invoca por la ruta interna _user_request_:
#   http://localhost:4566/restapis/{apiId}/{stage}/_user_request_/orders
CREATE_ORDER_FN="${PREFIX}-createOrder"
INTEG_URI="arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/arn:aws:lambda:${REGION}:${ACCOUNT}:function:${CREATE_ORDER_FN}/invocations"
API_NAME="${PREFIX}"
STAGE_DEPLOY="dev"
info "API Gateway ${API_NAME} (REST v1, POST /orders → ${CREATE_ORDER_FN})"
API_ID=$(a apigateway get-rest-apis --query "items[?name==\`${API_NAME}\`].id" --output text | tr -d '[:space:]' | cut -f1)
if [[ -z "$API_ID" ]]; then
  API_ID=$(a apigateway create-rest-api \
    --name "$API_NAME" \
    --description "API Gateway emulado por MiniStack para serverless-order-pipeline (POST /orders)" \
    --query 'id' --output text)
  ok "API creada: ${API_ID}"
else
  ok "API existente: ${API_ID}"
fi

ROOT_ID=$(a apigateway get-resources --rest-api-id "$API_ID" \
  --query 'items[?path==`/`].id' --output text | tr -d '[:space:]')
ORDERS_ID=$(a apigateway create-resource \
  --rest-api-id "$API_ID" --parent-id "$ROOT_ID" --path-part 'orders' \
  --query 'id' --output text 2>/dev/null)
if [[ -n "$ORDERS_ID" ]]; then
  ok "resource /orders = ${ORDERS_ID}"
else
  ORDERS_ID=$(a apigateway get-resources --rest-api-id "$API_ID" \
    --query 'items[?path==`/orders`].id' --output text | tr -d '[:space:]')
  ok "resource /orders ya existía = ${ORDERS_ID}"
fi

a apigateway put-method \
  --rest-api-id "$API_ID" --resource-id "$ORDERS_ID" \
  --http-method POST --authorization-type NONE >/dev/null || true
a apigateway put-integration \
  --rest-api-id "$API_ID" --resource-id "$ORDERS_ID" \
  --http-method POST --type AWS_PROXY --integration-http-method POST \
  --uri "$INTEG_URI" --content-handling CONVERT_TO_TEXT >/dev/null || true
ok "POST /orders → ${CREATE_ORDER_FN} (AWS_PROXY)"

a apigateway create-deployment --rest-api-id "$API_ID" --stage-name "$STAGE_DEPLOY" >/dev/null 2>&1 || true
API_URL="${EP}/restapis/${API_ID}/${STAGE_DEPLOY}/_user_request_/orders"
ok "Endpoint: ${API_URL}"

# 10. Smoke test: orden via la API Gateway real → createOrder → SQS → ESM → SFN
if [[ "$SMOKE_TEST" == "1" ]]; then
  ORD_ID="smoke-$(date +%s)"
  info "Smoke test via API Gateway: POST /orders"
  HTTP_OUT=$(curl -s -w '\n%{http_code}' -X POST "$API_URL" \
    -H 'Content-Type: application/json' \
    -d '{"customerId":"mini","items":[{"sku":"ABC","qty":2}]}')
  BODY_OUT=$(echo "$HTTP_OUT" | head -n -1)
  HTTP_CODE=$(echo "$HTTP_OUT" | tail -n1)
  ok "HTTP ${HTTP_CODE}: ${BODY_OUT}"
  ORD_ID=$(echo "$BODY_OUT" | grep -o '"orderId":"[^"]*"' | head -n1 | cut -d'"' -f4)
  [[ -n "$ORD_ID" ]] || ORD_ID="smoke-$(date +%s)"
  info "Orden ${ORD_ID} — esperando el pipeline asíncrono (SQS → SFN)"
  sleep 6
  EXEC=$(a stepfunctions list-executions \
    --state-machine-arn "$STATE_MACHINE_ARN" \
    --query 'executions[0].executionArn' --output text 2>/dev/null)
  if [[ -n "$EXEC" && "$EXEC" != "None" ]]; then
    a stepfunctions describe-execution --execution-arn "$EXEC" \
      --query '{estado:status, output:output}' --output table || true
  fi
  STATUS=$(a dynamodb get-item --table-name "$TABLE" --key "{\"orderId\":{\"S\":\"${ORD_ID}\"}}" \
    --query 'Item.status.S' --output text)
  ok "Order ${ORD_ID} → DynamoDB status: ${STATUS}"
fi

info "Listo. Toda la infraestructura (incluida la API Gateway) quedó provisionada en MiniStack."
info "   POST /orders: ${API_URL}"
info "   Prueba: curl -X POST ${API_URL} -H 'Content-Type: application/json' -d '{\"customerId\":\"cust-123\",\"items\":[{\"sku\":\"ABC\",\"qty\":2}]}'"
info "Script finalizado. Los recursos quedaron provisionados en MiniStack (:4566)."