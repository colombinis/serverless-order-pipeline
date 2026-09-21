# Historical: Previous serverless local setup approach
# See 0006-ministack-lambda-bootstrap.md for the current serverless-free approach.

# Teaching workspace initialized

Se estableció el workspace de enseñanza para el proyecto serverless-order-pipeline. El usuario quiere dominar cada servicio AWS del proyecto para la certificación, con foco en conceptos profundos y fallos comunes. Se identificaron 9 servicios: Lambda, API Gateway, DynamoDB, SQS, SNS, Step Functions, IAM, CloudFormation, CloudWatch. La misión es clara y concreta: certificación AWS con anclaje en código real.

_(Contexto actual: el proyecto ha migrado del setup con serverless Framework al uso de MiniStack + scripts directos. Los conceptos de servicios AWS siguen siendo válidos, pero el deploy local ya no usa serverless Framework.)_