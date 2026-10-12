# Glosario del Pipeline de Órdenes

Términos canónicos del arquitectura de este proyecto. Cada concepto se promueve aquí cuando el usuario lo comprende y puede usarlo correctamente, independientemente del framework de desplegar.

## Arquitectura

**Sync-then-async**:
Patrón donde la respuesta HTTP se completa rápido (síncrono) mientras el procesamiento real ocurre detrás (asíncrono), mediante colas y orquestadores.

_Nota_: el código HTTP de la respuesta NO está fijado por el patrón: `createOrder` devuelve 201 porque crea el recurso orden (fila PENDING con orderId). Un 202 sería apropiado solo si no existiera recurso creado (ver "201 Created" y "202 Accepted" más abajo).

## Protocolo HTTP

**201 Created**:
Código de éxito que afirma que la petición produjo la creación de un recurso identificable, que ya existe cuando llega la respuesta. Idealmente con header `Location` apuntando al recurso nuevo.

_En este proyecto_: `POST /orders` → `createOrder` escribe la fila en DynamoDB y devuelve 201 con el `orderId` en el cuerpo.

**202 Accepted**:
Código de éxito "no comprometido": la petición se aceptó para procesar, pero el procesamiento no terminó (o no empezó) y no hay forma de devolver su resultado luego.

_En este proyecto_: es lo que AWS devolvería (sin cuerpo) si API Gateway invocara la Lambda de forma asíncrona (`InvocationType: Event`); no es lo que `createOrder` devuelve.

**Desacoplamiento (decoupling)**:
Separación entre productor y consumidor mediante un intermediario (SQS/SNS) que evita que el fallo o lentitud de uno afecte al otro.

_Equivalente_: Patrón publisher-subscriber, cola de mensajería separada.

## Infraestructura como definición

**Definición declarativa**:
Archivo de configuración (YAML/JSON) que declara los recursos deseados y sus propiedades. El runtime se asegura de que el estado real coincida con el deseado.

_Nota_: Este proyecto usa `serverless.yml` como ejemplo de definición declarativa, pero el patrón es framework-agnóstico y aplicable con Terraform, CloudFormation, CDK, Pulumi, etc.

**CloudFormation / Infrastructure as Code**:
Servicio de AWS que convierte un template declarativo en recursos reales, de forma idempotente.

_Equivalente multiplataforma_: Terraform plan/apply, CDK8s, Pulumi up, Azure ARM templates.

**Least privilege**:
Principio por el cual una identidad recibe solo los permisos mínimos necesarios para su tarea.

_Equivalente_: Políticas IAM restrictivas, RBAC en Kubernetes.

## Emulación y local

**MiniStack**:
Emulador local de AWS que corre 60+ servicios en el puerto 4566, sin validar credenciales. Drop-in replacement de LocalStack.

_Aplicación actual_: Este proyecto usa MiniStack para emular DynamoDB, SQS, SNS, Step Functions, RDS y Redis localmente, conectándose mediante `AWS_ENDPOINT_URL`.

**AWS_ENDPOINT_URL**:
Variable de entorno que redirige las llamadas del SDK/CLI a un endpoint distinto del de AWS real, sin tocar el código.

_Uso en este proyecto_: `AWS_ENDPOINT_URL=http://ministack:4566` para que las Lambdas y el CLI apunten al emulador local en lugar de a AWS.

## Flujo de datos

**API Gateway**:
Capa de entrada HTTP que recibe peticiones y las enruta a las funciones de procesamiento.

_En este proyecto_: El endpoint `POST /orders` se provee mediante un servidor Express emulado en el container `app` (puerto 3000) que se conecta a MiniStack para las operaciones de datos. El flujo completo es: HTTP → Gateway emulado → Lambda (MiniStack) → DynamoDB/SQS/SFN.

**SQS (Simple Queue Service)**:
Cola de mensajes gestionada que garantiza entrega al menos una vez y desacopla productores de consumidores.

**SNS (Simple Notification Service)**:
Servicio de notificaciones fan-out que publica mensajes a suscriptores múltiples.

**Step Functions**:
Orquestación de workflows mediante state machines, con estados transicionales y manejo de errores (`Catch`, `Retry`).

## Consistencia e idempotencia

**Idempotencia**:
Propiedad por la cual re-ejecutar una operación con el mismo input produce el mismo resultado, sin efectos secundarios duplicados (dos órdenes, dos cargos, dos confirmaciones). La exige el Well-Architected Serverless Lens: *"design for failures and duplicates"*.

_En este proyecto_: createOrder no tiene key de idempotencia (uuidv4() por POST → retry duplica) y processOrder usa un nombre de ejecución con `Date.now()` que anula la idempotencia de `StartExecution`.

**At-least-once**:
Garantía de entrega de SQS estándar: un mensaje se entrega al menos una vez, pero puede entregarse más de una vez (copias) y ocasionalmente fuera de orden. Los consumidores deben ser idempotentes.

**Transacción outbox**:
Patrón que escribe el estado y el evento (o mensaje) en la misma transacción atómica (DynamoDB `TransactWriteItems`) y reenvía el evento a la cola mediante `DynamoDB Streams`. Garantiza que no existan órdenes huérfanas ni eventos perdidos: si la transacción no fue, el evento tampoco existió.

**Nombre de ejecución determinista**:
Pasar a `StartExecution` el mismo `name` (y `input`) para un mismo `orderId`, de modo que la idempotencia nativa de Step Functions (workflows STANDARD) devuelva la ejecución ya existente en vez de crear otra. Con `Date.now()` en el nombre, la idempotencia no aplica.

**Actualización condicional**:
`UpdateCommand` de DynamoDB con `ConditionExpression` (p. ej. `#status = :expected`) que solo escribe si el estado actual coincide; si no, lanza `ConditionalCheckFailedException` y el paso puede tratarse como no-op. Es la guarda atómica para consumidores idempotentes.

## Depuración

**Capa de debugging**:
Cada uno de los tres lugares donde aparece un error: logs del contenedor, logs del emulador/servicio, y estado de recursos vía CLI.

_flujo_: Ver logs `docker-compose logs -f app`, consultar MiniStack con `aws --endpoint-url http://localhost:4566`, y estado de state machines con `aws stepfunctions ...`.

**Matriz de versiones**:
Combinación de versiones de runtime, plataforma y dependencias cuya incompatibilidad causa errores típicos.

_Contexto actual_: Al no usar serverless Framework en local, las incompatibilidades han migrado de `serverless-offline/ESM` a la gestión manual de `zip` y `node_modules` para el empaquetado de Lambdas.