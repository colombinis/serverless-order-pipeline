# Bootstrap directo a MiniStack: Lambdas reales, ESM y el pipeline completo

Decisión de arquitectura local: **reemplazar el `serverless deploy` por un script
de provisión directa** cuando el destino es el emulador. MiniStack CF no puede
materializar el template de serverless; su camino documentado es crear recursos
por API. Con eso obtenemos MÁS que serverless-offline: eventos reales.

## Problemas verificados (después de la sesión 0005)
- `AWS_ENDPOINT_URL=http://localhost:4566 npm run deploy:local` en el host
  supera el "invalid token" (el env var faltaba en el host) y llega a MiniStack.
- MiniStack CF da `TemplateBody is required` (rechaza `TemplateURL`).
- Volcando el template completo con `--template-body` (serverless package +
  create/update-stack): **"Circular dependency detected"** entre
  LambdaFunction/LambdaVersion/LambdaPermission/HttpApiIntegration/Role.
  AWS real resuelve esto; el CF del emulador no. → El stack de serverless NO es
  creado por CF del emulador, sí y solo sí por API directa.

## MiniStack Lambda (verificado)
- `lambda create-function --runtime nodejs18.x --role <arn dummy> --code S3Bucket/S3Key` funciona.
- El runtime container despliega nodo 18, se une a la red docker de MiniStack y
  resuelve `ministack:4566` (mismo compose). MiniStack inyecta ACCESS_KEY → cuenta
  123456789012. Env de función: `AWS_ENDPOINT_URL=http://ministack:4566` hace que el
  SDK v3 del código apunte a services del emulador.
- `lambda update-function-code --s3-bucket --s3-key` y
  `update-function-configuration --environment` son requeridos por MiniStack → los
  re-runs del script son rápidos (zip subido 1 vez).
- **Event Source Mapping SQS→Lambda FUNCIONA**: `create-event-source-mapping`
  consumió los mensajes de `serverless-order-pipeline-order-queue-dev` y disparó
  processOrder automáticamente (log: "ESM: Lambda ... processed 1 SQS messages").
- **Step Functions ejecuta Tasks reales**: StartExecution recorrió
  ValidateStock→ReserveInventory→ChargePayment→ConfirmOrder→NotifyCustomer en
  SUCCEEDED; cada Task arranca su worker Lambda (cold start ≈ 5-6 s). El role ARN
  no se valida (dummy ok).

## El script
`scripts/ministack-bootstrap.sh`:
1. `zip` nativo si falta el ZIP (replica `src/` + `package.json` + `node_modules`
   de producción; sin serverless package).
2. Sube el zip al deployment bucket (clave con timestamp).
3. Crea/idempotente: tabla, cola, tópico, state machine, 8 Lambdas, ESM.
4. Env de las Lambdas: ORDERS_TABLE / ORDER_QUEUE_URL (ministack) /
   NOTIFICATIONS_TOPIC_ARN / STATE_MACHINE_ARN / AWS_ENDPOINT_URL.
5. **API Gateway real**: `create-rest-api` `serverless-order-pipeline-dev`,
   resource `/orders`, `put-method POST`, integración AWS_PROXY a `createOrder`,
   `create-deployment` → stage `dev`, imprime `API_URL`.
6. Smoke test integrado: `curl POST $API_URL` + describe-execution + get-item.

### Lecciones de idempotencia
- Probes nativos (`describe-table`, `get-queue-url`, `get-topic-attributes`,
  `describe-state-machine`) en vez de `list-*` + grep sobre `--query`: el
  JMESPath filtrado de MiniStack devolvió vacío (p.ej. `[?stateMachineArn==...]`),
  y comparar URLs de cola por host (localhost vs ministack) da falsos negativos.

## Evidence del cierre
- `curl -X POST "$API_URL" -d '{...}'` → 201. Logs MiniStack: ESM consumió 1 msg → processOrder
  → "Step Functions execution started". `describe-execution` SUCCEEDED con output
  `{"orderId":"...","status":"CONFIRMED"}` y la fila en DynamoDB quedó CONFIRMED.
- SNS: notifyCustomer publicó sobre el tópico (no hay suscripción, no se entrega).

## Implications (para el examen)
- serverless.yml ≠ emulador: es la fuente de verdad para AWS real; el emulador pide
  el API directo. Esta dualidad (declarativo para producción, script para local) es
  el patrón que MiniStack/LocalStack recomiendan.
- El "cold start" por Task (≈5-6 s por Lambda) es una noción real de AWS que aquí se
  ve materializada — buena para explicar tiempo de ejecución de un workflow.
- Empaquetado mínimo pendiente: el zip oficial trae devDeps y `.opencode/` (bloat 41MB).