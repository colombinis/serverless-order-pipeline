# Fixes aplicados: idempotencia de createOrder y consumidor idempotente en processOrder

Se aplicaron las dos curas de la Lección 5 al código real, con tests verdes (14/14 con cobertura 93-96% en handlers).

Evidence:
- `createOrder.js`: idempotency key vía orderId determinístico (`ord-` + sha256(customerId|key) truncado a 32 hex) + `PutCommand` con `ConditionExpression: attribute_not_exists(orderId)`. La condición funciona de lock atómico ante POST concurrentes idénticos: el perdedor hace GetItem y replays (201 con `replay: true`), sin re-encolar. Sin key se mantiene el camino uuidv4() original. Tests nuevos: mismo key→mismo orderId, replay sin SendMessage, keys distintas→órdenes distintas, mismo key distintos customers→órdenes distintas, y assertion de que la condición se manda.
- `processOrder.js`: nombre de ejecución determinista `order-${orderId}` (era `order-${orderId}-${Date.now()}`) + swallow de `ExecutionAlreadyExists` (redelivery de una ejecución ya cerrada no debe fallar el batch). Tests nuevos: nombre determinista, mismo nombre en dos redeliveries del mismo orderId, y deglución de ExecutionAlreadyExists.
- `npm run lint` NO funciona por falta de `.eslintrc` (condición pre-existente del repo, sin config; no es un problema introducido).

Implicaciones:
- La reproducción en MiniStack (ejercicio de la lección 5) queda pendiente de que el usuario levante docker: bootstrap + POST duplicado (antes: dos orderIds, después: el mismo con `replay: true`).
- Cura B del lesson (transaction outbox) sigue sin aplicar — es el siguiente candidato si se quiere cerrar el hueco write-then-enqueue por completo, junto con `ConditionExpression` en `updateOrderStatus` (cura C en los Tasks).