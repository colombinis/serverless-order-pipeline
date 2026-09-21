# AWS Certification Resources

## Knowledge

- [AWS Well-Architected — Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html)
  Official guide for serverless architecture patterns. Use for: understanding why services are composed the way they are, and the Well-Architected pillars.
- [Design Principles — Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/general-design-principles.html)
  Core design principles: orchestrate with state machines, events over polling, design for failures and duplicates. Use for: justifying architecture decisions in this project and in exam questions.
- [Serverless Framework — serverless.yml reference](https://www.serverless.com/framework/docs/providers/aws/guide/serverless.yml)
  Official reference for every section of serverless.yml: provider, functions, events, IAM. Use for: understanding how this project's file translates to CloudFormation.
- [MiniStack Docs](https://ministack.org/docs)
  Official docs for the AWS emulator used by this project: routing on port 4566, persistence, env vars, differences vs real AWS. Use for: understanding the local emulation and its limits.
- [MiniStack GitHub](https://github.com/ministackorg/ministack)
  Source repo and changelog. Use for: checking what's emulated, known differences, and version behavior.
- [AWS Documentation — Lambda Developer Guide](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
  Primary source for Lambda concepts: execution model, limits, triggers, concurrency. Use for: cold starts, memory/CPU relationship, timeout behavior.
- [AWS Documentation — DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
  Primary source for DynamoDB: capacity modes, partition keys, eventually consistent reads, DAX. Use for: understanding the OrdersTable design.
- [AWS Documentation — Step Functions Developer Guide](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
  Primary source for Step Functions: state machine types (Standard vs Express), error handling, callbacks. Use for: understanding the order fulfillment workflow.
- [AWS Documentation — Amazon States Language](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html)
  The JSON/YAML dialect that defines state machines. Use for: reading/editing the definition embedded in serverless.yml and in ministack-bootstrap.sh.
- [AWS Documentation — SQS Developer Guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
  Primary source for SQS: visibility timeout, dead-letter queues, at-least-once delivery. Use for: understanding the async decoupling pattern.
- [AWS Documentation — SNS Developer Guide](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
  Primary source for SNS: fan-out pattern, message filtering, delivery retries. Use for: understanding the notification pattern.
- [AWS Documentation — API Gateway Developer Guide](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html)
  Primary source for API Gateway: HTTP API vs REST API, throttling, authorization. Use for: understanding the POST /orders endpoint.
- [AWS Certified Solutions Architect — Official Practice Question Sets](https://explore.skillbuilder.aws/learn/course/external/view/elearning/13406/aws-certified-solutions-architect-associate-official-practice-question-sets-saa-c03)
  Official practice questions from AWS. Use for: testing understanding against real exam format.
- [AWS FAQ Pages](https://aws.amazon.com/faqs/)
  Service-specific FAQs are the highest-yield exam prep. Prioritize: Lambda FAQ, DynamoDB FAQ, SQS FAQ, Step Functions FAQ. Use for: limits, pricing gotchas, edge cases.

## Wisdom (Communities)

- [r/AWSCertifications](https://reddit.com/r/AWSCertifications)
  Active community of certification candidates. Use for: study strategies, practice exam discussions, exam day tips.
- [AWS re:Post](https://repost.aws/)
  Official AWS Q&A community. Use for: service-specific questions answered by AWS engineers.
- [r/aws](https://reddit.com/r/aws)
  General AWS community. Use for: architecture discussions, real-world war stories, service comparison debates.
- [Serverless Framework GitHub Discussions](https://github.com/serverless/serverless/discussions)
  Official community for the Serverless Framework. Use for: plugin version incompatibilities, offline/local emulation issues.

## Gaps

- No encontré material específico sobre errores comunes de Step Functions en certificación — lo cubrimos directamente en las lecciones.
- Los practice labs hands-on para DynamoDB + Lambda interaction son limitados — resuelto en local con `scripts/ministack-bootstrap.sh` + MiniStack (ver learning-records/0006): Sandbox funcional de DynamoDB/Lambda/Step Functions con eventos reales.
- La compatibilidad entre serverless-offline (ESM) y versiones de Node es un campo minado de documentación dispersa; queda anotado en learning records como caso de estudio vivo.
