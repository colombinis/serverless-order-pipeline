# Historical: serverless.yml and CloudFormation local setup
# This document describes the previous approach using serverless Framework.
# See 0006-ministack-lambda-bootstrap.md for the current serverless-free bootstrap approach.

# serverless.yml traduce infraestructura a CloudFormation

El usuario entiende el rol de `serverless.yml` como plano declarativo único: sus secciones (`provider`, `functions`, `stepFunctions`, `resources`, `custom`) se traducen a un template CloudFormation, y las variables de entorno (`${self:...}`, `!Ref`, `!GetAtt`) conectan el código con los recursos. Fue capaz de distinguir los dos modos de ejecución (offline emula API GW+Lambdas en :3000; deploy envía CloudFormation a MiniStack/:4566) y de usar las 3 capas de debugging.

_(Contexto actual: el proyecto ya no usa serverless Framework en local. El archivo `serverless.yml` sirve como fuente de verdad para AWS real, pero el despliegue local se realiza mediante `scripts/ministack-bootstrap.sh` que provisiona recursos directamente contra MiniStack mediante API calls, saltándose CloudFormation por sus limitaciones de TemplateURL y Lambda::Version.)_

## Evidence
- Lección 2 completada con quizzes sobre deploy/flujo de offline/enrutamiento de MiniStack.
- Diagnóstico en vivo: identificó que el error `ERR_REQUIRE_ESM` no es de código ni de serverless.yml sino de matriz de versiones.

## Implications
- La siguiente lección puede profundizar en el deploy real contra MiniStack (crear recursos, verificar entradas).
- Recordar en futuras lecciones que el usuario ya domina: interpolación vs funciones intrínsecas, least privilege, y las 3 capas de logs. El patrón actual es: bootstrap script → MiniStack → gateway emulado.