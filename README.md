# serverless-order-pipeline

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
#   Crea: API Gateway REST v1 (POST /orders → createOrder), tabla DynamoDB, cola
#   SQS, tópico SNS, state machine, 8 Lambdas, event source mapping SQS→processOrder.
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
| **Lambda** | Las 8 funciones del proyecto, configuración, variables de entorno |
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
| `scripts/ministack-bootstrap.sh` | **Provisiona todo en MiniStack**: API Gateway REST v1 (POST /orders → createOrder), tabla DynamoDB, cola SQS, tópico SNS, state machine, 8 Lambdas, event source mapping SQS→processOrder. Empaqueta el zip con `zip` nativo (sin Serverless Framework). Idempotente. Al final imprime la URL del endpoint. |
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

## Probar el flujo completo (después del bootstrap)

```bash
# 1. Crear una orden (HTTP 201, escribe en DynamoDB, encola en SQS).
#    Usa la URL que imprime el bootstrap (apiId = ID que reporta el script):
curl -X POST http://localhost:4566/restapis/<apiId>/dev/_user_request_/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "cust-123", "items": [{"sku": "ABC", "qty": 2}]}'

# 2. Ver el estado final en DynamoDB (usar orderId de la respuesta)
aws --endpoint-url http://localhost:4566 dynamodb get-item \
  --table-name serverless-order-pipeline-orders-dev \
  --key '{"orderId":{"S":"<orderId-del-paso-1>"}}'

# 3. O ver las ejecuciones en Step Functions
aws --endpoint-url http://localhost:4566 stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfillmentStateMachine

# 4. O correr el smoke test del bootstrap (POST real a la API Gateway)
scripts/ministack-bootstrap.sh SMOKE_TEST=1

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
| AWS Lambda | Las 8 funciones en `src/handlers/` |
| SQS | `OrderQueue`, consumida por `processOrder` |
| Step Functions | `OrderFulfillmentStateMachine` en `serverless.yml` |
| DynamoDB | `OrdersTable`, acceso vía `src/lib/orders.js` |
| SNS | `OrderNotificationsTopic`, usado en `notifyCustomer` y `cancelOrder` |
| REST API | API Gateway real de MiniStack: `POST /orders` → `createOrder` (creada por el bootstrap vía CLI, invocada por `/_user_request_/`) |
| Testing (unit tests) | `tests/` con Jest + `aws-sdk-client-mock` |
| CI/CD | `.github/workflows/ci.yml` (deploy a AWS real con Serverless Framework) |
| OMS / e-commerce | El dominio completo: orden -> stock -> inventario -> pago -> confirmación |

## Próximos pasos si querés extender el proyecto

- Agregar un endpoint `GET /orders/{orderId}` para consultar estado (misma técnica:
  `create-resource` + `put-method` + `put-integration` en el bootstrap).
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
AWS CLI contra `:4566`. El bootstrap crea la REST API (`POST /orders` → `createOrder`)
y la publica en el stage `dev`. Todo vive en **un solo servicio** de docker-compose:

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