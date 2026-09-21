# Historical: 4 causas raíz del arranque local con serverless
# This document describes previous issues with serverless-offline local setup.
# All 4 causes were related to serverless Framework plugins and are no longer applicable.

# Cadena completa de arranque del entorno local: 4 causas raíz

_(Contexto actual: ya no se usa serverless Framework en local. La cadena de 4 causas ya no aplica. El nuevo setup usa: Docker Compose + MiniStack + bootstrap script que provisiona también una API Gateway REST v1 real en MiniStack. No hay plugins serverless-offline ni serverless-dynamodb-local en la cadena.)_

La app del proyecto no arrancaba por una cadena de 4 problemas encadenados, cada uno destapado tras corregir el anterior. Cada capa de error aparecía en un lugar distinto:

1. **`ERR_REQUIRE_ESM`** (capa 1): `serverless-offline@13.10.1` es ESM y Node 18 no podía `require()`-arlo. Fix: `node:22-alpine` en el Dockerfile (build + runner).
   - *Actual*: No aplica; el nuevo Dockerfile usa node:22-alpine y el empaquetado es nativo zip.

2. **`spawn java ENOENT`** (capa 1): el plugin `serverless-dynamodb-local` intentaba arrancar DynamoDB Local (requiere Java), pero la imagen no tiene Java y además es redundante con MiniStack.
   - *Actual*: No aplica; MiniStack provee DynamoDB nativamente.

3. **`TypeError: Cannot read properties of null (reading 'serverless-offline')`** (capa 1): al dejar `custom` sin claves, serverless-offline lee `service.custom['serverless-offline']`.
   - *Actual*: No aplica; no hay configuración serverless-offline en el nuevo setup.

4. **Connection reset / HTTP 000** (capa 1/red): serverless-offline bindea a `localhost` dentro del contenedor; el port-forwarding de Docker llega al eth0 del contenedor.
   - *Actual*: No aplica; ya no existe un gateway HTTP en proceso. La API Gateway la emula MiniStack (:4566), invocable por `_user_request_`.

Tras los 4 fixes, `POST /orders` llegaba a la Lambda y fallaba con `ResourceNotFoundException` porque MiniStack no tenía los recursos aún (capa 3: `list-tables` vacío). La provisión de recursos quedaba como próxima lección.

- *Actual*: El flujo completo ahora es: `docker-compose up -d` → `scripts/ministack-bootstrap.sh` (crea recursos Y la API Gateway, imprime la URL) → `curl POST http://localhost:4566/restapis/{apiId}/dev/_user_request_/orders`.

## Evidence
- Cada fix verificado con `docker compose ps`, `docker logs`, y `curl POST /orders`.
- El test end-to-end hoy: HTTP llega a Lambda, Lambda llama a DynamoDB en MiniStack. Cadena probada.

## Implications
- Lección 3 natural: proveer los recursos en MiniStack (crear tabla/cola/tópico/sfm) y correr el flujo completo incluyendo SQS→Step Functions.
- En certificación: los errores encadenados enseñan a leer el stack trace completo antes de "arreglar" — la primera causa puede no ser la única.
- *Actual*: El patrón recomendado ya no tiene estas 4 causas, al eliminar serverless Framework de la cadena local.