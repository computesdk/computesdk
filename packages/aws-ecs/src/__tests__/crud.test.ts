import { runProviderCrudTest } from '@computesdk/test-utils';
import { fargate } from '../index';

runProviderCrudTest({
  name: 'fargate',
  provider: fargate({
    cluster: process.env.AWS_ECS_CLUSTER || 'test-cluster',
    taskDefinition: process.env.AWS_TASK_DEFINITION || 'test-task-def',
    subnets: process.env.AWS_SUBNETS?.split(',') || ['subnet-12345'],
    securityGroups: process.env.AWS_SECURITY_GROUPS?.split(',') || ['sg-12345'],
  }),
  skipIntegration: !process.env.AWS_ECS_CLUSTER || !process.env.AWS_TASK_DEFINITION || !process.env.AWS_SUBNETS || !process.env.AWS_SECURITY_GROUPS
});