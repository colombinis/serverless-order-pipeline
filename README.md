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

- Node.js 18+
- Cuenta de AWS con credenciales configuradas (`aws configure`)
- `npm install -g serverless` (o usar `npx serverless`)

## Instalación

```bash
npm install
```

## Desarrollo local

```bash
# Instala el plugin de DynamoDB local la primera vez
sls dynamodb install

# Levanta DynamoDB local + serverless-offline (API Gateway + Lambda emulados)
npm run offline
```

Nota: `serverless-offline` emula bien HTTP + Lambda, pero **no emula SQS, Step
Functions ni SNS**. Para probar el flujo completo end-to-end sin desplegar,
la alternativa es levantar [LocalStack](https://www.localstack.cloud/) y
apuntar los clientes de AWS SDK a su endpoint (mismo patrón que ya usamos
para DynamoDB en `src/lib/dynamo.js` con `IS_OFFLINE`).

## Tests

```bash
npm test
```

Corre Jest con mocks del AWS SDK (`aws-sdk-client-mock`), sin necesidad de
credenciales ni recursos reales desplegados. Genera reporte de cobertura.

## Deploy a AWS

```bash
npm run deploy          # stage dev
npm run deploy:prod     # stage prod
```

Esto crea todos los recursos (tabla DynamoDB, cola SQS, tópico SNS, state
machine, funciones Lambda y el endpoint de API Gateway) vía CloudFormation,
gestionado por Serverless Framework.

## Probar el flujo completo ya desplegado

```bash
curl -X POST https://<tu-endpoint>/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "cust-123", "items": [{"sku": "ABC", "qty": 2}]}'
```

Revisar el estado de la orden en la tabla DynamoDB (`orderId` devuelto en la
respuesta), o ver la ejecución completa en la consola de Step Functions.

Para forzar el camino de cancelación, mandar un `qty` mayor a 100 en algún item.

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
