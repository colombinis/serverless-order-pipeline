# CloudWatch Logs Insights queries

Los logs son JSON de Powertools: `level`, `message` y `orderId` son campos autodetectados.

## 1. Errores recientes

fields @timestamp, message, orderId
| filter level = "ERROR"
| sort @timestamp desc
| limit 50

## 2. Latencia por ventana de 5 minutos (reportes de Lambda)

filter @type = "REPORT"
| stats avg(@duration), pct(@duration, 95), max(@duration), count(*) by bin(5m)

## 3. Arranques en frío (cold starts)

filter ispresent(@initDuration)
| stats count() as coldStarts, avg(@initDuration) as avgInitMs by bin(1h)

## 4. Trazabilidad de una orden puntual (caso de soporte)

fields @timestamp, level, message, orderId
| filter orderId = "REEMPLAZAR-ORDER-ID"
| sort @timestamp asc
