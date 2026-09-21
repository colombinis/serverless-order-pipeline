# Notes

## ESTADO ACTUAL (2026-09-17 — serverless-free en local)
- **DECISIÓN DEFINITIVA**: el setup local NO usa Serverless Framework. Se eliminaron del setup local: scripts `npm` (`offline`, `deploy`, `deploy:local`, `deploy:prod`, `logs:createOrder`), dep de serverless en package.json, `serverless-offline`/`serverless-step-functions`, y la instalación global en el Dockerfile.
- **Setup local actual**: `docker-compose up -d` (MiniStack + StackPort + DynamoDB Admin) → `scripts/ministack-bootstrap.sh` crea en MiniStack la **API Gateway REST v1 real** (`POST /orders` → `createOrder`, por control-plane vía CLI) + recurso/data-plane (8 Lambdas, tabla, cola, tópico, SFN, ESM) empaquetando con `zip` nativo. Se invoca por `http://localhost:4566/restapis/{apiId}/dev/_user_request_/orders`. **Ya no hay Express**: MiniStack emula API Gateway completo (v1 REST 86 ops, v2 HTTP 42 ops).
- **`serverless.yml` queda SOLO para AWS real** (despliegue de producción con `serverless deploy --stage prod`), con un header que lo aclara. No se toca en el flujo local.
- `.serverless/` (artefactos del deploy local) eliminado y fuera de gitignore.

## Preferencias del usuario
- El usuario habla español — todas las lecciones y explicaciones en español.
- Foco en certificación AWS: conceptos profundos + fallos comunes.
- Anclaje en código real del proyecto, no en teoría abstracta.
- El usuario usa "MiniStack" (ministackorg/ministack), no LocalStack.
- **Grabado a fuego**: localmente NO se usa serverless. Toda referencia de serverless del setup local debe eliminarse.

## Estado del entorno (2026-09-10, tarde — deploy y recursos)
- **`npm run deploy` en el host fallaba** con `The security token included in the request is invalid`: sin `AWS_ENDPOINT_URL`, fue contra AWS real con credenciales del emulador.
- **Causa raíz**: Serverless Framework usa SDK v2 (`aws-sdk`) para CloudFormation y el SDK v2 **ignora** `AWS_ENDPOINT_URL` (solo el SDK v3 del código lo lee). Verificado empíricamente en el contenedor.
- **Fix**: `scripts/sls-v2-endpoint.js` (shim vía `NODE_OPTIONS=--require`) + script `deploy:local`. Con eso el deploy SÍ llega a MiniStack.
- **Siguiente muro**: MiniStack CF no resuelve `TemplateURL` (serverless sube el template a S3) → `TemplateBody is required`. Deploy completo vía serverless NO soportado por MiniStack hoy.
- **Solución aplicada**: provisión directa de los 4 recursos data-plane vía AWS CLI contra :4566: tabla `serverless-order-pipeline-orders-dev`, cola `...-order-queue-dev`, tópico `...-notifications-dev`, state machine `OrderFulfillmentStateMachine` (SFN: los Tasks referencian Lambdas que no existen en MiniStack — limitación a documentar).
- **Bug SQS resuelto**: el env de la lambda NO hereda `ORDER_QUEUE_URL` del contenedor (offline solo copia vars `AWS_*` y luego aplica `provider.environment`). docker-compose hardcodeaba la URL con cuenta placeholder `000000000000` → corregido a `123456789012`, y en serverless.yml se cambió a `${env:ORDER_QUEUE_URL, fallback}` (fallback = URL real de AWS).
- **Hoy funciona**: `POST :3000/orders` → 201, escribe en DynamoDB (PENDING) y encola en SQS. A esa altura serverless-offline NO consumía la cola (no dispara processOrder) — superado el 13-09 por el bootstrap con ESM de MiniStack (ver sección de noche).

## Estado del entorno (2026-09-13, noche — bootstrap completo en MiniStack)
- **Bootstrap script funcional**: `scripts/ministack-bootstrap.sh` crea los 4 resources data-plane + registra las **8 Lambdas** en MiniStack y arma el **Event Source Mapping SQS→processOrder**. Idempotente (probes nativos: describe-table/get-queue-url/get-topic-attributes/describe-state-machine). Desde la migración (API Gateway por CLI), además crea la REST API v1 con `POST /orders` → `createOrder`.
- **Pipeline corriendo end-to-end por la vía real**: `POST /orders` vía API Gateway real de MiniStack (ruta interna `_user_request_`) → DynamoDB PENDING → SQS → **MiniStack ESM consume** → processOrder → SFN empieza execution → 5 Tasks (validateStock/reserveInventory/chargePayment/confirmOrder/notifyCustomer) → **status CONFIRMED** en DynamoDB. MiniStack SNS recibe el publish de notifyCustomer.
- **MiniStack Lambda activa**: runtime nodejs18.x, `lambda create-function`/`invoke` funcionan. El contenedor de ejecución llega a `ministack:4566` (misma red docker) y MiniStack inyecta la cuenta 123456789012.
- CF del emulador NO puede materializar el template de serverless (TemplateURL no soportado **y** ahora confirmado "circular dependency" en Lambda::Version/Integration/Role → UPDATE_FAILED). El camino documentado (provisión directa por API) es el que usa el script. `update-function-code --s3-*` funciona en MiniStack (los reruns actualizan código sin re-subir a cada función).
- Los últimos N pedidos demo: status CONFIRMED. Para transaction real en AWS, `serverless deploy` sigue siendo el camino (el yml es la fuente de verdad).

## Pendientes observados
- **Lección 3 creada** (`lessons/0003-ministack-bootstrap-scripts.html`): por qué el CF del emulador no materializa el template de serverless, el script de bootstrap, la comparación offline vs MiniStack, y el pipeline E2E. Quizzes 4/4 validados con Playwright (favicon 404 inofensivo). Lección 2 actualizada con corrección del "Modo A" + nav a la 3.
- Los greps sobre `--query JMESPath` con filtros (p.ej. `[?stateMachineArn==...]`) NO son confiables en MiniStack: el script usa describir/get como probes nativos.
- El zip de Lambda se empaqueta con `zip` nativo (solo `src/` + prod deps). El bloat de 41MB del `serverless package` ya no aplica.
- dynamo.js tiene override `IS_OFFLINE -> localhost:8000` que entra en conflicto con MiniStack (:4566) — revisado en esta sesión.
- serverless.yml declara runtime `nodejs18.x` (para AWS real); Node 18 es EOL (abr 2025). Considerar nodejs20.x/22.x si se despliega a AWS.

## Cómo abrir lecciones
- `python3 -m http.server 3847` en la raíz del repo si hace falta servirlas (Playwright no acepta file://).
- Para depurar el env en local, consultar las vars del container (`docker-compose exec ministack env`) o las del bootstrap (`COMMON_ENV`) — el flujo local no usa `serverless print`.