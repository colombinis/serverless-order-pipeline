# serverless-order-pipeline

Pipeline serverless de fulfillment de órdenes en AWS, pensado como proyecto
para cubrir los "requisitos" de una proyecto orientada a OMS de e-commerce +
AWS serverless (Lambda, Step Functions, DynamoDB, SQS/SNS).

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
- **No requiere cuenta AWS real** - MiniStack emula 60+ servicios localmente

### Opción B: Desarrollo local tradicional
- Node.js 18+
- Cuenta de AWS con credenciales configuradas (`aws configure`)
- `npm install -g serverless` (o usar `npx serverless`)

## Instalación

### Opción A: Con Docker + MiniStack (Recomendado)

```bash
# 1. Levanta la infraestructura: MiniStack + App + DynamoDB Admin + StackPort
docker-compose up -d

# 2. Espera a que MiniStack esté healthy (aprox. 10-15s)
# Ver: curl http://localhost:4566/health

# 3. Provisiona recursos + Lambdas directamente en MiniStack (bootstrap)
npm run bootstrap:ministack
#   Esto crea: tabla DynamoDB, cola SQS, tópico SNS, state machine, 8 Lambdas,
#   event source mapping SQS→processOrder, y ejecuta un smoke test E2E.

# Ver logs de la app
docker-compose logs -f app

# Ver logs de MiniStack
docker-compose logs -f ministack

# Para bajar todo
docker-compose down
```

El endpoint de la API estará disponible en: `http://localhost:3000`

El panel de DynamoDB Admin en: `http://localhost:8001`

**StackPort (AWS Resource Browser)** en: `http://localhost:8081`

MiniStack health check: `curl http://localhost:4566/health`

StackPort health check: `curl http://localhost:8081/api/health`

### Opción B: Instalación tradicional

```bash
npm install
```

## Desarrollo local

### Opción A: Con Docker + MiniStack (Recomendado - Full AWS emulation)

```bash
# Levanta DynamoDB local + serverless-offline (API Gateway + Lambda emulados)
# MiniStack emula TODOS los servicios: SQS, Step Functions, SNS, DynamoDB, etc.
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f app
```

**Ventajas clave:**
- ✅ **SQS, Step Functions, SNS funcionan nativamente** - `serverless-offline` solo emula HTTP + Lambda
- ✅ **RDS Postgres real** - MiniStack levanta contenedor Postgres real en puerto 15432
- ✅ **ElastiCache Redis real** - Contenedor Redis real en puerto 16379
- ✅ **Multi-account / multi-region** - Aislamiento completo por Access Key ID
- ✅ **Compatible con Terraform, CDK, Pulumi, AWS CLI, SDKs** - Drop-in replacement

### Opción B: Solo serverless-offline (Limitado)

```bash
# Instala el plugin de DynamoDB local la primera vez
sls dynamodb install

# Levanta DynamoDB local + serverless-offline (API Gateway + Lambda emulados)
npm run offline
```

**Limitaciones conocidas:**
- ❌ `serverless-offline` **NO emula SQS, Step Functions ni SNS**
- ❌ Para flujo end-to-end completo sin AWS real, necesitas MiniStack o LocalStack
- ✅ Sirve para pruebas unitarias de handlers HTTP + Lambda aislados

### Variables de entorno para desarrollo con MiniStack

El `docker-compose.yml` configura automáticamente:

```bash
IS_OFFLINE=true
AWS_ENDPOINT_URL=http://ministack:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=123456789012
AWS_SECRET_ACCESS_KEY=test
```

En el código, `src/lib/dynamo.js` ya detecta `IS_OFFLINE` y apunta a `localhost:8000`. 
Con MiniStack, el cliente DynamoDB usa `http://ministack:4566` automáticamente via `AWS_ENDPOINT_URL`.

## StackPort — Visualizador de recursos AWS

**StackPort** es un panel web open-source para navegar e inspeccionar recursos en emuladores AWS (MiniStack, LocalStack, Moto) y cuentas AWS reales. En este proyecto se levanta como servicio en `docker-compose.yml`.

### Qué puedes hacer con StackPort en este proyecto

| Servicio | Qué ver/inspeccionar |
|----------|---------------------|
| **DynamoDB** | Tabla `serverless-order-pipeline-orders-dev`, items, atributos, capacidad |
| **SQS** | Cola `serverless-order-pipeline-order-queue-dev`, mensajes en cola, atributos |
| **SNS** | Tópico `serverless-order-pipeline-notifications-dev`, suscripciones |
| **Step Functions** | State machine `OrderFulfillmentStateMachine`, definiciones, ejecuciones |
| **Lambda** | Las 8 funciones del proyecto, configuración, variables de entorno |
| **CloudWatch Logs** | Logs de cada Lambda invocada |
| **IAM** | Roles y políticas creadas por Serverless Framework |

### Acceso

- URL: `http://localhost:8081`
- Health check: `curl http://localhost:8081/api/health`
- API endpoints: `curl http://localhost:8081/api/endpoints`

StackPort se conecta automáticamente a MiniStack vía `AWS_ENDPOINT_URL=http://ministack:4566` (configurado en docker-compose). No requiere configuración adicional.

## Scripts disponibles

| Script | Qué hace |
|--------|----------|
| `npm run bootstrap:ministack` | **Provisiona todo en MiniStack**: tabla DynamoDB, cola SQS, tópico SNS, state machine, 8 Lambdas, event source mapping SQS→processOrder. Ejecuta smoke test E2E opcional (`SMOKE_TEST=0` para saltarlo). |
| `npm run deploy:local` | `serverless deploy` contra MiniStack usando shim SDK v2 (`scripts/sls-v2-endpoint.js`). **Limitado**: MiniStack CF no soporta `TemplateURL` ni `Lambda::Version` → no materializa Lambdas reales. |
| `npm run offline` | `serverless offline start` — emula solo API Gateway + Lambda en puerto 3000. **NO emula** SQS, Step Functions, SNS. |

### ¿Por qué `bootstrap:ministack` en vez de `serverless deploy`?

MiniStack implementa CloudFormation, pero con **limitaciones conocidas**:
1. **No resuelve `TemplateURL`** — Serverless sube el template a S3 y pasa la URL; MiniStack exige `TemplateBody` (archivo local).
2. **No crea `AWS::Lambda::Function` + `AWS::Lambda::Version`** — dependencias circulares no soportadas.
3. **No valida IAM roles** — roles dummy son aceptados pero no funcionales.

La solución: **provisionar data-plane directo vía AWS CLI** contra el endpoint MiniStack (:4566). El script `scripts/ministack-bootstrap.sh` es **idempotente** (re-actualiza código/env si el recurso existe) y usa los **mismos nombres** que `serverless.yml` para consistencia.

Ver detalles técnicos en: `learning-records/0005-ministack-deploy-and-lambda-env.md`

## Tests

```bash
npm test
```

Corre Jest con mocks del AWS SDK (`aws-sdk-client-mock`), sin necesidad de
credenciales ni recursos reales desplegados. Genera reporte de cobertura.

## Probar el flujo completo (después de `bootstrap:ministack`)

```bash
# 1. Crear una orden (HTTP 201, escribe en DynamoDB, encola en SQS)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "cust-123", "items": [{"sku": "ABC", "qty": 2}]}'

# 2. El event source mapping SQS→processOrder dispara la Lambda automáticamente
#    que invoca Step Functions StartExecution

# 3. Ver el estado final en DynamoDB (usar orderId de la respuesta)
aws --endpoint-url http://localhost:4566 dynamodb get-item \
  --table-name serverless-order-pipeline-orders-dev \
  --key '{"orderId":{"S":"<orderId-del-paso-1>"}}'

# 4. O ver la ejecución completa en Step Functions
aws --endpoint-url http://localhost:4566 stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfillmentStateMachine

# Para forzar el camino de cancelación, mandar un qty mayor a 100 en algún item.
```

## Mapeo contra los requisitos de la proyecto

| Requisito del proyecto | Dónde está en este proyecto |
|---|---|
| AWS Lambda | Las 8 funciones en `src/handlers/` |
| SQS | `OrderQueue`, consumida por `processOrder` |
| Step Functions | `OrderFulfillmentStateMachine` en `serverless.yml` |
| DynamoDB | `OrdersTable`, acceso vía `src/lib/orders.js` |
| SNS | `OrderNotificationsTopic`, usado en `notifyCustomer` y `cancelOrder` |
| REST API | Endpoint `POST /orders` vía API Gateway |
| Testing (unit tests) | `tests/` con Jest + `aws-sdk-client-mock` |
| CI/CD | `.github/workflows/ci.yml` |
| OMS / e-commerce | El dominio completo: orden -> stock -> inventario -> pago -> confirmación |

## Próximos pasos si querés extender el proyecto

- Agregar un endpoint `GET /orders/{orderId}` para consultar estado.
- Agregar un Dead Letter Queue (DLQ) a `OrderQueue` para mensajes que fallan repetidamente.
- Agregar retries configurables (`Retry`) en los steps de la state machine además del `Catch`.
- Sumar `serverless-offline` + LocalStack para poder correr el flujo end-to-end sin AWS real.
