# Historical: serverless-offline ESM and Node version matrix
# This document describes a previous issue with serverless-offline ESM compatibility.
# The current approach uses native zip packaging without serverless-offline.

# Matriz de versiones: serverless-offline ESM vs Node 18

Caso de estudio real resuelto durante la Lección 2. El contenedor `app` crasheaba con `ERR_REQUIRE_ESM`: `serverless-offline@13.10.1` se publica como ES module (`"type": "module"`), y Node 18 no podía `require()`-arlo. Fix: subir la base del Dockerfile a `node:22-alpine` (require/esm nativo).

_(Contexto actual: el proyecto ya no usa serverless-offline en local. El empaquetado de Lambdas se hace ahora con zip nativo mediante `scripts/ministack-bootstrap.sh`, y la entrada HTTP es una API Gateway REST v1 real creada por el propio bootstrap en MiniStack (control-plane vía CLI, ruta interna `_user_request_`). Los problemas de compatibilidad ESM forman parte de la historia del setup anterior con serverless.)_

## Evidence
- `docker logs serverless-order-pipeline-app` mostraba el error repetido; verificado el campo `type: module` en el package.json instalado de serverless-offline 13.10.1, y Node 18.20.8 en la imagen `node:18-alpine`. Confirmado que serverless-offline es ESM desde v11; v10 es la última versión CommonJS.
- MiniStack estaba sano pero vacío: esto demostró que en modo offline los recursos no se crean y deben existir previamente.

## Implications
- Arreglo aplicado en el nuevo setup: Dockerfile usa `node:22-alpine` y el zip se empaqueta con scripts bash/nativos.
- Lección para certificación: los distractores de "matriz de versiones incompatible" son frecuentes; leer el stack trace completo antes de tocar código.
- El patrón actual no tiene esta dependencia: no hay serverless-offline en la cadena de local.