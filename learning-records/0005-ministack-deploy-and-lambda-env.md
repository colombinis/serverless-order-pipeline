# Historical: Deploy a MiniStack with serverless SDK v2/v3 (previous approach)
# This document describes the previous approach using `npm run deploy:local` and serverless Framework.
# The current approach uses `scripts/ministack-bootstrap.sh` for direct provisioning.
# Useful context: many concepts (SDK versions, TemplateURL limitations, ENV handling) remain relevant.

# Deploy a MiniStack: SDK v2 vs v3, TemplateURL y el env de las Lambdas

`npm run deploy:local` fallaba con `The security token included in the request is invalid`. Cadena de causas descubiertas en vivo:

## 1. SDK v2 ignora AWS_ENDPOINT_URL (Serverless Framework)
- Serverless Framework v3 mezcla SDKs: CloudFormation/STS/S3 usan `aws-sdk` (v2); API Gateway/Lambda/S3 (otros clientes) usan `@aws-sdk` (v3).
- El código de los handlers usa v3, que **sí** lee `AWS_ENDPOINT_URL`. El v2 **no**: ignora env y va a `amazonaws.com` real.
- Prueba empírica en el contenedor: `new AWS.CloudFormation({})` con `AWS_ENDPOINT_URL` seteado → `InvalidClientTokenId`; con `{endpoint: 'http://ministack:4566'}` → `OK stacks: 0`.
- `provider.accountId` no aparece en el schema de v3 (warning de validación) y no alcanza para esto.

### Fix
- `scripts/sls-v2-endpoint.js`: shim cargado con `NODE_OPTIONS=--require .../sls-v2-endpoint.js` que hace `AWS.config.update({ endpoint: process.env.AWS_ENDPOINT_URL, s3ForcePathStyle: true })`.
- Script `npm run deploy:local`. En el contenedor (env MiniStack) queda listo; con esto el deploy SÍ llega al CF de MiniStack.

_(Contexto actual: el proyecto ya no usa `npm run deploy:local` en local. El shim `sls-v2-endpoint.js` se mantuvo para compatibilidad histórica, pero la vía recomendada es `scripts/ministack-bootstrap.sh` que provisiona recursos directamente por API — incluida la API Gateway REST v1 — evitando CF completamente.)_

## 2. MiniStack CF no soporta TemplateURL
- Con el shim, el deploy avanza hasta "The CloudFormation template is invalid: TemplateBody is required".
- serverless sube el template compilado a S3 y llama CF con `TemplateURL`. MiniStack espera `TemplateBody` explícito (que es como documenta su CF: `create-stack --template-body file://template.yaml`).
- Alcanza a crear el stack bootstrap (deployment bucket + policy) y muere en el update con el template real.

### Fix aplicado
- Provisionar los recursos data-plane directo con la AWS CLI contra :4566 (no CF): tabla DynamoDB, cola SQS, tópico SNS, state machine (mismo nombre que serverless.yml).
- El stack de CF queda "CREATE_COMPLETE" pero genérico; los recursos reales se administran por CLI.
- Estado: SFN crea la machine, pero sus Tasks referencian ARNs de Lambdas inexistentes en MiniStack → StartExecution fallará en el primer Task.

## 3. ORDER_QUEUE_URL: por qué la lambda no hereda el env del contenedor
- La env del handler NO es `process.env` del contenedor. serverless-offline (`LambdaFunction.js`) construye: `AWS_*` del proceso + `provider.environment` + `function.environment`.
- docker-compose hardcodeaba `ORDER_QUEUE_URL=http://ministack:4566/000000000000/...` (cuenta placeholder) — MiniStack usa la access key de 12 dígitos como account.
- `!Ref OrderQueue` en offline resuelve con cuenta placeholder → `QueueDoesNotExist` de MiniStack aunque la cola exista.

### Fix
- docker-compose: URL con account `123456789012` (coincide con `MINISTACK_ACCOUNT_ID`).
- serverless.yml: patrón `${env:ORDER_QUEUE_URL, 'https://sqs.${self:provider.region}.amazonaws.com/123456789012/...'}`
  → offline toma la URL del contenedor; deploy real cae al fallback real.
- `serverless print` (dentro del contenedor) es el mejor aliado para ver la config ya resuelta.

_(Contexto actual: en el nuevo setup, las variables de entorno se fijan en `COMMON_ENV` del bootstrap y se inyectan a las Lambdas al crearlas/actualizarlas. No hay interpolación `${env:...}` de serverless.yml ni serverless-offline.)_

## Evidence
- `curl POST :3000/orders` → HTTP 201, item PENDING en DynamoDB, mensaje `{"orderId":...}` en SQS.
- Standalone `SendMessageCommand` con URL ministack funcionó (isoló bug del env de la lambda).
- serverless-offline NO consume la cola (no hay logs de processOrder) — el mensaje queda en SQS.

## Implications
- En certificación: conocer que "el endpoint se resuelve en capas (opción → config → env)" y que los emuladores exigen endpoint explícito en SDKs legacy.
- serverless-offline no dispara eventos SQS; el flujo async end-to-end requiere MiniStack ejecutando Lambdas reales o un polling externo.

_(Contexto actual: el flujo actual es: `scripts/ministack-bootstrap.sh` crea los recursos en MiniStack incluyendo una API Gateway REST v1 real (`POST /orders` → createOrder, por control-plane CLI), y las Lambdas leen `AWS_ENDPOINT_URL` del entorno. No se usa serverless-offline para consumir la cola; el event source mapping SQS→Lambda se gestiona directamente en el bootstrap.)_