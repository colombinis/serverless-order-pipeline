# serverless-order-pipeline

![CI/CD](https://github.com/colombinis/serverless-order-pipeline/actions/workflows/ci.yml/badge.svg)

Pipeline de fulfillment de órdenes en AWS, pensado como proyecto
para cubrir los "requisitos" de una proyecto orientada a OMS de e-commerce +
AWS serverless (Lambda, Step Functions, DynamoDB, SQS/SNS).

> **Nota sobre el stack local**: el desarrollo local NO usa Serverless Framework.
> Se usa **Docker Compose + MiniStack** (emulador de AWS, incluye API Gateway real)
> + un **bootstrap script** que crea los recursos directamente contra el emulador
> vía AWS CLI. El archivo `serverless.yml` es únicamente para el despliegue a AWS
> real (`serverless deploy --stage prod`).

## Arquitectura

```
Cliente HTTP
     |
     v
[API Gateway] --POST /orders--> [Lambda: createOrder]
                                       |
                                       |-- PutItem (status: PENDING) --> [DynamoDB: Orders]
                                       |
                                       '-- SendMessage --------------> [SQS: OrderQueue]
                                                                             |
                                                                             v
                                                                            [Lambda: processOrder]
                                                                             |
                                                                           StartExecution
                                                                           v
                                                             [Step Functions: OrderFulfillmentStateMachine]
                                                                             |
                                                           ValidateStock -> ReserveInventory -> ChargePayment -> ConfirmOrder -> NotifyCustomer
                                                                 |                  |                 |
                                                                 '------------------'-----------------'--> (Catch) --> CancelOrder
                                                                                                                                         |
                                                                                                                                       PublishMessage  v
                                                                                                                                                 [SNS: OrderNotificationsTopic]
```

## Por qué esta arquitectura

- **API Gateway + Lambda desacoplado de SQS**: el cliente HTTP no espera a que
  termine todo el flujo de fulfillment (que puede tardar segundos). `createOrder`
  responde rápido con `201` y el procesamiento real ocurre de forma asíncrona.
- **SQS entre la creación y el procesamiento**: si `processOrder` falla o
  hay un pico de órdenes, los mensajes quedan en la cola en vez de perderse.
  Es el patrón de desacople que la mayoría de los OMS reales usan.
- **Step Functions en vez de encadenar Lambdas a mano**: cada paso
  (`validateStock`, `reserveInventory`, `chargePayment`, `confirmOrder`,
  `notifyCustomer`) es una función simple, de una sola responsabilidad. La
  orquestación, los reintentos y el manejo de errores (`Catch` -> `CancelOrder`)
  quedan declarados en la definición de la state machine, no en código imperativo.
- **DynamoDB como store principal de la orden**: acceso de baja latencia por
  `orderId`, sin necesidad de gestionar schema/migraciones.
- **SNS para notificaciones**: desacopla "algo pasó con la orden" de "quién se
  entera" — se puede sumar un suscriptor de email, otra Lambda, o un webhook
  sin tocar el código de negocio.

## Requisitos previos

### Opción A: Desarrollo local con Docker + MiniStack (Recomendado)

- Docker Desktop / Docker Engine + Docker Compose
- **No requiere cuenta AWS real** — MiniStack emula 60+ servicios localmente.
- **No se usa Serverless Framework** en el flujo local (ver bootstrap abajo).

### Opción B: Despliegue a AWS real

- Node.js 18+
- Cuenta de AWS con credenciales configuradas (`aws configure`)
- `npm install -g serverless` (o usar `npx serverless`)

## Instalación y arranque local (con Docker + MiniStack)

```bash
# 1. Levanta MiniStack (emula todos los servicios AWS, incluido API Gateway) + DynamoDB Admin + StackPort
docker-compose up -d

# 2. Espera a que MiniStack esté healthy (aprox. 10-15s)
curl http://localhost:4566/health

# 3. Provisiona TODOS los recursos directamente en MiniStack (bootstrap)
scripts/ministack-bootstrap.sh
#   Crea: API Gateway REST v1 (POST /orders → createOrder y GET /orders/{orderId} →
#   getOrder), tabla DynamoDB, cola SQS, tópico SNS, state machine, 9 Lambdas,
#   event source mapping SQS→processOrder.
#   Empaqueta el zip con zip nativo. Re-ejecutable (idempotente): actualiza el
#   código de las Lambdas si ya existen. Al final imprime la URL del endpoint.

# Ver logs
docker-compose logs -f ministack

# Para bajar todo
docker-compose down
```

El endpoint de la API lo imprime el bootstrap al terminar, y tiene la forma:
`http://localhost:4566/restapis/{apiId}/dev/_user_request_/orders`
(miniStack invoca una REST API por la ruta interna `_user_request_`).

Paneles auxiliares:
- DynamoDB Admin: `http://localhost:8001`
- StackPort (AWS Resource Browser): `http://localhost:8081`
- MiniStack health check: `curl http://localhost:4566/health`
- StackPort health check: `curl http://localhost:8081/api/health`

## Desarrollo local

### Opción A: Con Docker + MiniStack (Recomendado - Full AWS emulation)

```bash
# 1. Levanta MiniStack + DynamoDB Admin + StackPort
docker-compose up -d

# 2. Opcional: ver logs en tiempo real
docker-compose logs -f ministack

# 3. Provisiona todo (idempotente)
scripts/ministack-bootstrap.sh
```

**Ventajas clave:**
- ✅ **MiniStack emula API Gateway de verdad** (REST v1 de 86 ops y HTTP v2 de 42 ops). El bootstrap crea la REST API por control-plane (`create-rest-api` → `create-resource` → `put-method` → `put-integration` → `create-deployment`) y la engancha a las Lambdas, igual que en AWS. Se invoca con `/_user_request_/`.
- ✅ **SQS, Step Functions, SNS funcionan nativamente** sobre MiniStack
- ✅ **RDS Postgres real** — MiniStack levanta contenedor Postgres real en puerto 15432
- ✅ **ElastiCache Redis real** — Contenedor Redis real en puerto 16379
- ✅ **Multi-account / multi-region** — Aislamiento completo por Access Key ID
- ✅ **Compatible con Terraform, CDK, Pulumi, AWS CLI, SDKs** — Drop-in replacement
- ✅ **Lambda code hot-reload** — los cambios en `src/handlers/` se reflejan al re-correr el bootstrap

### Opción B: MiniStack solo (sin los paneles auxiliares)

```bash
docker-compose up -d ministack
# Luego corre el bootstrap: crea los recursos Y la API Gateway real en MiniStack:
scripts/ministack-bootstrap.sh
```

Útil para probar handlers Lambda aislados contra MiniStack, o para
integraciones con herramientas externas (StackPort, Terraform contra el emulador).
El bootstrap crea la API Gateway igual que en la Opción A — no hay diferencia
de capacidades, solo faltan DynamoDB Admin y StackPort.

## Variables de entorno para desarrollo con MiniStack

El `docker-compose.yml` configura las credenciales de prueba en los containers, y
el bootstrap (`COMMON_ENV` en `scripts/ministack-bootstrap.sh`) inyecta a las
Lambdas las variables del entorno:

```bash
AWS_ENDPOINT_URL=http://localhost:4566   # CLI contra el emulador
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=123456789012
AWS_SECRET_ACCESS_KEY=test
ORDERS_TABLE=serverless-order-pipeline-orders-dev
ORDER_QUEUE_URL=http://localhost:4566/123456789012/serverless-order-pipeline-order-queue-dev
NOTIFICATIONS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:serverless-order-pipeline-notifications-dev
STATE_MACHINE_ARN=arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfillmentStateMachine
```

En el código, `src/lib/dynamo.js` detecta `IS_OFFLINE` y apunta a `localhost:8000`
para DynamoDB local standalone; con MiniStack el cliente usa
`http://ministack:4566` automáticamente vía `AWS_ENDPOINT_URL`.

## StackPort — Visualizador de recursos AWS

**StackPort** es un panel web open-source para navegar e inspeccionar recursos en emuladores AWS (MiniStack, LocalStack, Moto) y cuentas AWS reales. Se levanta en `docker-compose.yml`.

### Qué puedes hacer con StackPort en este proyecto

| Servicio | Qué ver/inspeccionar |
|----------|---------------------|
| **DynamoDB** | Tabla `serverless-order-pipeline-orders-dev`, items, atributos, capacidad |
| **SQS** | Cola `serverless-order-pipeline-order-queue-dev`, mensajes en cola, atributos |
| **SNS** | Tópico `serverless-order-pipeline-notifications-dev`, suscripciones |
| **Step Functions** | State machine `OrderFulfillmentStateMachine`, definiciones, ejecuciones |
| **Lambda** | Las 9 funciones del proyecto, configuración, variables de entorno |
| **CloudWatch Logs** | Logs de cada Lambda invocada |
| **IAM** | Roles y políticas creadas por las Lambdas |

### Acceso

- URL: `http://localhost:8081`
- Health check: `curl http://localhost:8081/api/health`

StackPort se conecta automáticamente a MiniStack vía `AWS_ENDPOINT_URL=http://ministack:4566`.
No requiere configuración adicional.

## Scripts disponibles

| Script | Qué hace |
|--------|----------|
| `scripts/ministack-bootstrap.sh` | **Provisiona todo en MiniStack**: API Gateway REST v1 (POST /orders → createOrder y GET /orders/{orderId} → getOrder), tabla DynamoDB, cola SQS, tópico SNS, state machine, 9 Lambdas, event source mapping SQS→processOrder. Empaqueta el zip con `zip` nativo (sin Serverless Framework). Idempotente. Al final imprime la URL del endpoint. |
| `scripts/local-invoke.js` | **Invocá un handler en proceso** (sin emulador de Lambda), con breakpoints desde VSCode: `node scripts/local-invoke.js createOrder`. Apunta a MiniStack (`:4566`) con las mismas vars del bootstrap. Perfecto para depurar paso a paso cada función. |
| `scripts/test.sh` | **Ejemplo de API Gateway real sobre MiniStack**: crea una REST API con `GET /saludo/{nombre}`, la enlaza a una Lambda y la invoca por `/_user_request_/`, verificando también los logs en CloudWatch. Útil para entender el control-plane del emulador. |
| `npm test` | Jest con mocks del AWS SDK (`aws-sdk-client-mock`), sin necesidad de credenciales ni recursos reales. |
| `npm run lint` | ESLint sobre `src/` y `tests/`. |

### ¿Por qué un bootstrap script en vez de `serverless deploy`?

MiniStack implementa CloudFormation, pero con **limitaciones conocidas** que hacen
que el template generado por Serverless Framework no se materialice en el emulador:

1. **No resuelve `TemplateURL`** — Serverless sube el template a S3 y pasa la URL; MiniStack exige `TemplateBody` (archivo local).
2. **No crea `AWS::Lambda::Function` + `AWS::Lambda::Version`** — dependencias circulares no soportadas.
3. **No valida IAM roles** — roles dummy son aceptados pero no funcionales.

**Importante:** estas limitaciones son del *CloudFormation* del emulador, **no** de
su emulación de API Gateway. MiniStack emula API Gateway (REST v1 de 86 ops y HTTP
v2 de 42 ops) completa por control-plane: el propio bootstrap crea la API real con
la AWS CLI (`create-rest-api` → `create-resource` → `put-method` →
`put-integration` → `create-deployment`) y la engancha a `createOrder`, igual que
en AWS. No hace falta ningún servidor HTTP aparte.

La solución: **provisionar directo vía AWS CLI** contra el endpoint MiniStack (`:4566`),
incluyendo el control-plane de API Gateway. El script es **idempotente** (re-actualiza
código/env si el recurso existe) y usa los **mismos nombres** que `serverless.yml`
para consistencia (el yml es la fuente de verdad solo para AWS real).

## Tests

```bash
npm test
```

Corre Jest con mocks del AWS SDK (`aws-sdk-client-mock`), sin necesidad de
credenciales ni recursos reales desplegados. Genera reporte de cobertura.

## Failure modes tested

Los comportamientos de fallo están cubiertos con pruebas reproducibles, no solo declarados.

| Fallo | Cómo se probó | Resultado esperado |
| --- | --- | --- |
| **Mensaje venenoso → DLQ** | Publicar `not-json` en la cola | Tras `maxReceiveCount=3` queda en la DLQ (`queue=0`, `dlq=1`) |
| **Fallo parcial de lote** | Lote mixto: 4 válidos + 1 inválido | `ReportBatchItemFailures`: los 4 válidos se procesan, solo el inválido va a la DLQ |
| **Consumidor idempotente** | Re-entregar el mismo mensaje SQS | `ExecutionAlreadyExists` → no-op, no se crea una segunda ejecución |
| **Sin stock (no overselling)** | 20 órdenes de 1 unidad contra 5 disponibles, en paralelo | 5 `CONFIRMED`, 15 `CANCELLED`, stock final `0` (**nunca negativo**) |
| **Compensación (saga)** | `Catch` → `CancelOrder`, que libera la reserva | Stock repuesto **una sola vez** (`attribute_not_exists(releasedAt)`) |
| **Retry de errores transitorios** | `Retry` en el ASL (5 errores `Lambda.*`, backoff 2s→4s→8s) | `OutOfStock` **no** se reintenta; corre 1 vez y va al `Catch` específico |
| **Transición inválida / replay** | Re-invocar un paso sobre una orden ya `CONFIRMED` | La `ConditionExpression` rechaza el retroceso (no-op) |

## Observability

Instrumentado con **Powertools for AWS Lambda** (Logger, Metrics, Tracer): logs en
JSON, métricas de negocio por EMF y trazas X-Ray, todo declarado en `serverless.yml`.

### Qué hay, dónde vive y qué se ve

| Pieza | Dónde vive | Qué se ve |
| --- | --- | --- |
| **Logs estructurados** | `src/lib/observability.js` (`logger`) | CloudWatch Logs, retención **14 días**. JSON con `level`, `message`, `orderId`, `cold_start` |
| **Métricas de negocio (EMF)** | `metrics` en `src/lib/observability.js` | Namespace `OrderPipeline`: `OrderAccepted`, `OrderConfirmed`, `OrderCancelled`, `OutOfStock` |
| **Métricas técnicas** | Lambda / API Gateway / SQS / Step Functions | `Errors`, `Throttles`, latencia, profundidad de cola, ejecuciones |
| **Trazas** | `tracer` + `captureAWSv3Client` (DynamoDB, SQS, SFN, SNS) | X-Ray: mapa de servicios y subsegmentos por llamada AWS |
| **Alarmas** | `serverless.yml` (`AlarmTopic` + 3 alarmas) | CloudWatch Alarms; notifican por email (ver abajo) |
| **Dashboard** | `observability/dashboard.json` | CloudWatch Dashboards → `OrderPipeline` (5 widgets) |
| **Consultas** | `observability/queries.md` | CloudWatch Logs Insights: errores, latencia p95, cold starts, orden puntual |

Configuración relevante en `serverless.yml`: `provider.tracing` (Lambda + API Gateway),
`logRetentionInDays: 14`, `tracingConfig: { enabled: true }` en la state machine y las
variables `POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_LOG_LEVEL`,
`POWERTOOLS_METRICS_NAMESPACE` y `POWERTOOLS_TRACE_ENABLED`.

### Alarmas

| Alarma | Dispara cuando |
| --- | --- |
| `DlqNotEmptyAlarm` | hay al menos 1 mensaje en la DLQ (`ApproximateNumberOfMessages > 0`) |
| `CreateOrderErrorsAlarm` | `createOrder` acumula errores en la ventana |
| `WorkflowFailedAlarm` | Step Functions registra ejecuciones fallidas |

Las tres publican en el tópico SNS `AlarmTopic`. El email de destino **no está hardcodeado**
(este repo es público): se toma de la variable `ALARM_EMAIL` al desplegar.

```bash
ALARM_EMAIL=tu-email@dominio.com npm exec serverless -- deploy
```

```bash
# Ver las alarmas creadas
aws cloudwatch describe-alarms --query 'MetricAlarms[].AlarmName' --output text
```

### Dashboard

Se versiona como código y se aplica por API (así el panel es reproducible y revisable en el PR):

```bash
aws cloudwatch put-dashboard --dashboard-name OrderPipeline \
  --dashboard-body file://observability/dashboard.json

# Verificar
aws cloudwatch get-dashboard --dashboard-name OrderPipeline \
  --query DashboardBody --output text | python3 -m json.tool
```

### Consultas de logs

Las cuatro consultas listas para pegar en **Logs Insights** están en
[`observability/queries.md`](observability/queries.md): errores recientes, latencia p95 por
ventana, cold starts y la traza completa de una orden puntual (caso de soporte).

### Evidencia en local: el log real de una orden

El emulador **sí** guarda los logs de Lambda. Se leen con `filter-log-events` (no aparecen en
`docker compose logs`, y el log group existe recién después de la primera invocación):

```bash
aws --endpoint-url http://localhost:4566 logs filter-log-events \
  --log-group-name /aws/lambda/serverless-order-pipeline-dev-createOrder \
  --limit 5 --query 'events[].message' --output text
```

De una invocación real (no de un test) sale el log estructurado y su línea EMF — cada una es una
sola línea en la salida real:

```json
{"level":"INFO","message":"Order accepted","timestamp":"2026-10-15T16:21:03.143Z","service":"order-pipeline","sampling_rate":0,"orderId":"3a45c919-cb45-4d98-9b9f-3cbbc93b0ce7","customerId":"mini","itemCount":1}
{"_aws":{"Timestamp":1792081263147,"CloudWatchMetrics":[{"Namespace":"OrderPipeline","Dimensions":[["service"]],"Metrics":[{"Name":"OrderAccepted","Unit":"Count"}]}]},"service":"order-pipeline","OrderAccepted":1}
```

### Falla provocada: mensaje venenoso → DLQ

No alcanza con declarar la DLQ: acá se **provocó la falla**. Se envía a la cola un mensaje que
`processOrder` no puede parsear (`not-json`); el consumidor lo reporta vía
`ReportBatchItemFailures` y, tras `maxReceiveCount=3`, SQS lo mueve a la DLQ.

```bash
export AWS_ACCESS_KEY_ID=123456789012 AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
EP=http://localhost:4566
Q=$(aws --endpoint-url $EP sqs get-queue-url \
      --queue-name serverless-order-pipeline-order-queue-dev --query QueueUrl --output text)
D=$(aws --endpoint-url $EP sqs get-queue-url \
      --queue-name serverless-order-pipeline-order-queue-dev-dlq --query QueueUrl --output text)

# Acelerar el redrive SOLO para la prueba (y restaurar después)
aws --endpoint-url $EP sqs set-queue-attributes --queue-url "$Q" \
  --attributes '{"VisibilityTimeout":"5"}'

aws --endpoint-url $EP sqs send-message --queue-url "$Q" --message-body 'not-json'

sleep 30   # 3 reintentos + redrive

aws --endpoint-url $EP sqs get-queue-attributes --queue-url "$D" \
  --attribute-names ApproximateNumberOfMessages --output text   # → 1

# El cuerpo original se preserva intacto para diagnosticar
aws --endpoint-url $EP sqs receive-message --queue-url "$D" \
  --query 'Messages[0].Body' --output text                      # → not-json

# Restaurar el valor real
aws --endpoint-url $EP sqs set-queue-attributes --queue-url "$Q" \
  --attributes '{"VisibilityTimeout":"180"}'
```

Resultado observado: DLQ `0 → 1`, cuerpo `not-json` preservado, `VisibilityTimeout` de vuelta
en `180`.

### Limitaciones del entorno local (MiniStack)

El emulador no replica la observabilidad completa, así que conviene ser explícito sobre qué se
verifica en local y qué requiere AWS real:

- **Sin daemon X-Ray**: las trazas se instrumentan (los subsegmentos se generan) pero no hay
  dónde visualizarlas.
- **Las métricas no se ingestan**: las líneas EMF salen como texto en los logs, pero
  `cloudwatch list-metrics` queda **vacío** → las alarmas no se evalúan (no cambian de estado) y
  un dashboard local se ve **sin datos**. Que una alarma llegue a mandar un email requiere AWS real.
- **Sin retención aplicada**: `logRetentionInDays: 14` lo aplica el `serverless deploy`; en local
  los log groups quedan sin `retentionInDays`.
- **Lo que sí se verifica en local**: los logs estructurados **reales** de cada invocación
  (`filter-log-events`, ver arriba), que el dashboard y las alarmas sean definiciones válidas
  (`put-dashboard` sin mensajes de error y `describe-alarms` las lista) y que la falla de la DLQ
  ocurra de verdad (el taladro de abajo, reproducible).

## Probar el flujo completo (después del bootstrap)

```bash
# Base URL (el bootstrap imprime el apiId; forma: .../restapis/<apiId>/dev/_user_request_)
BASE=http://localhost:4566/restapis/<apiId>/dev/_user_request_

# 1. Crear una orden: HTTP 201 + header Location, escribe en DynamoDB, encola en SQS.
#    (El contrato vive en openapi.yaml)
curl -i -X POST "$BASE/orders" \
  -H "Content-Type: application/json" \
  -d '{"customerId": "cust-123", "items": [{"sku": "ABC", "qty": 2}]}'

# 1b. Idempotencia: la MISMA idempotencyKey dos veces → MISMO orderId.
#     La 2ª responde 201 con "replay": true y NO re-encola.
curl -X POST "$BASE/orders" -H "Content-Type: application/json" \
  -d '{"customerId":"cust-123","items":[{"sku":"ABC","qty":2}],"idempotencyKey":"abc-123"}'
curl -X POST "$BASE/orders" -H "Content-Type: application/json" \
  -d '{"customerId":"cust-123","items":[{"sku":"ABC","qty":2}],"idempotencyKey":"abc-123"}'

# 1c. Misma key con OTRO body → 422 (application/problem+json, RFC 9457)
curl -X POST "$BASE/orders" -H "Content-Type: application/json" \
  -d '{"customerId":"cust-123","items":[{"sku":"ZZZ","qty":9}],"idempotencyKey":"abc-123"}'

# 2. Consultar la orden: HTTP 200 con su estado; 404 (problem+json) si no existe
curl "$BASE/orders/<orderId>"

# 3. Ver el item en DynamoDB (usar orderId de la respuesta)
aws --endpoint-url http://localhost:4566 dynamodb get-item \
  --table-name serverless-order-pipeline-orders-dev \
  --key '{"orderId":{"S":"<orderId>"}}'

# 4. O ver las ejecuciones en Step Functions
aws --endpoint-url http://localhost:4566 stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfillmentStateMachine

# 5. O correr el smoke test del bootstrap (POST real a la API Gateway)
SMOKE_TEST=1 scripts/ministack-bootstrap.sh

# Para bajar todo
docker-compose down
```

## Depurar paso a paso (VSCode, sin emulador de Lambda)

Cada handler es **una función Node común** `(event, context)`. Eso permite
invocarlo como proceso local contra MiniStack, con breakpoints reales:

```bash
node scripts/local-invoke.js createOrder
node scripts/local-invoke.js validateStock --body '{"orderId":"123"}'
node scripts/local-invoke.js processOrder --body '{"orderId":"123"}'   # wrapper SQS automático
```

El harness reutiliza los nombres y el endpoint del bootstrap
(`AWS_ENDPOINT_URL=http://localhost:4566` + las mismas vars de `COMMON_ENV`).
Tipos de evento:

| Handler | Evento generado |
|---|---|
| `createOrder` | `{ body: '<json>' }` (API Gateway) |
| `processOrder` | `{ Records: [{ body: '<json>' }] }` (SQS) |
| el resto | `{ orderId, ... }` directo (Step Functions Task) |

**Con VSCode**: este repo incluye `.vscode/launch.json` — usá *Run and Debug*
("Invoke Lambda handler (local)"), poné un breakpoint en un handler (p.ej.
`src/handlers/validateStock.js:15`) y la config te pide el nombre del handler.
Para detenerte en el arranque (antes del primer `await`), usá la config con
*"estallido frío"* (`stopOnEntry`).

> Nota: no se puede hacer step-through **dentro de la cadena async**
> SQS→SFN (cada paso corre en un contenedor separado). El patrón es:
> debugear cada handler en aislamiento con `local-invoke.js` y validar el
> encadenamiento con el smoke test del bootstrap + logs.

## Mapeo contra los requisitos de la proyecto

| Requisito del proyecto | Dónde está en este proyecto |
|---|---|
| AWS Lambda | Las 9 funciones en `src/handlers/` |
| SQS | `OrderQueue`, consumida por `processOrder` |
| Step Functions | `OrderFulfillmentStateMachine` en `serverless.yml` |
| DynamoDB | `OrdersTable`, acceso vía `src/lib/orders.js` |
| SNS | `OrderNotificationsTopic`, usado en `notifyCustomer` y `cancelOrder` |
| REST API | API Gateway real de MiniStack: `POST /orders` → `createOrder` y `GET /orders/{orderId}` → `getOrder`, con contrato en `openapi.yaml` (201 + `Location`, errores RFC 9457). Creada por el bootstrap vía CLI, invocada por `/_user_request_/` |
| Testing (unit tests) | `tests/` con Jest + `aws-sdk-client-mock` |
| CI/CD | `.github/workflows/ci.yml` (deploy a AWS real con Serverless Framework) |
| OMS / e-commerce | El dominio completo: orden -> stock -> inventario -> pago -> confirmación |

## Próximos pasos si querés extender el proyecto

- Agregar un Dead Letter Queue (DLQ) a `OrderQueue` para mensajes que fallan repetidamente.
- Agregar retries configurables (`Retry`) en los steps de la state machine además del `Catch`.
- Probar el flujo con **LocalStack** en vez de MiniStack para comparar limitaciones.
- Agregar monitoreo de métricas a CloudWatch (logs ya están configurados).

## ¿Por qué a veces parece que "no se levantan todos los servicios"?

Es normal confundirse por el siguiente punto:

**MiniStack no materializa el template CloudFormation que genera Serverless
Framework** (no resuelve `TemplateURL` y no soporta el ciclo de `Lambda::Version`).
Por eso `serverless deploy` contra `:4566` no crea la API Gateway *desde el yml*.
Pero esto **no** significa que MiniStack no pueda emular API Gateway: la emulación
(REST v1 de 86 ops y HTTP v2 de 42 ops) funciona completa por control-plane, con la
AWS CLI contra `:4566`. El bootstrap crea la REST API (`POST /orders` → `createOrder`
y `GET /orders/{orderId}` → `getOrder`) y la publica en el stage `dev`. Todo vive en **un solo servicio** de docker-compose:

1. **`ministack` service** (puerto 4566): provee los servicios de data-plane (SQS, SNS, Step Functions, DynamoDB, RDS, Redis) **y API Gateway**. Se accede con `aws --endpoint-url http://localhost:4566`.

Cuando ejecutas `docker-compose up -d` y luego `scripts/ministack-bootstrap.sh`,
MiniStack queda con todos los recursos y la API Gateway publicada. Las Lambdas usan
`AWS_ENDPOINT_URL=http://ministack:4566` para leer/escribir a la tabla, cola, state
machine, etc. Las llamadas HTTP van a
`http://localhost:4566/restapis/{apiId}/dev/_user_request_/orders` y
MiniStack las enruta a la Lambda `createOrder` (integración AWS_PROXY), exactamente
como haría AWS real.

Si no corres el bootstrap, `docker-compose up -d` solo levanta el emulador vacío —
no hay tabla, cola, Lambdas ni API todavía. Para el flujo completo necesitas el
bootstrap (idempotente: correrlo dos veces no duplica nada).

## Licencia

MIT License.