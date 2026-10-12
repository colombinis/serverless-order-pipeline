# 201 vs 202: el status code no es el patrón (y el comentario del código lo confundía)

El usuario detectó una imprecisión real entre los materiales y el código: la Lección 1 y el código afirman que `createOrder` devuelve 201, pero el comentario del handler hablaba de un "202-style flow" y el GLOSSARY vinculaba sync-then-async con "respuesta 202". El usuario preguntó si 201 no debería ser 202 — una pregunta de discriminación entre dos códigos de éxito que son fácilmente confundibles en arquitecturas async.

Evidencia de comprensión: distinguió que el *patrón* (sync-then-async) es ortogonal al *código* (201 vs 202), y que la presencia de un recurso creado es el discriminador. Se demostró contra fuentes primarias (RFC 9110 vía MDN 201/202, AWS Invoke API: RequestResponse→200, Event→202, DryRun→204; viaje async de API Gateway con X-Amz-Invocation-Type: Event).

Implicaciones para futuras sesiones:
- Crear la Lección 4 (`0004-201-vs-202-createOrder.html`) + cheatsheet de códigos HTTP (`reference/0002-http-status-codes-api.html`).
- El bloqueo conceptual siguiente (probable Lección 5 / fallo clásico del patrón): si `createOrder` escribe DynamoDB y DESPUÉS SQS, ¿qué pasa si el envío a SQS falla pero la escritura ya ocurrió? → idempotencia, consistencia y reintentos, tema central de examen.