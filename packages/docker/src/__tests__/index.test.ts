import { runProviderTestSuite } from '@computesdk/test-utils';
import { docker } from '../index';

const runIntegration =
  process.env.RUN_INTEGRATION === '1' ||
  process.env.RUN_INTEGRATION === 'true';
const skipIntegration = !runIntegration;

const dockerPython = docker({
  runtime: 'python',
  image: { name: process.env.DOCKER_PY_IMAGE || 'python:3.11-slim', pullPolicy: 'ifNotPresent' },
  container: { workdir: '/workspace', autoRemove: true },
});

const dockerNode = docker({
  runtime: 'node',
  image: { name: process.env.DOCKER_NODE_IMAGE || 'node:20-alpine', pullPolicy: 'ifNotPresent' },
  container: { workdir: '/workspace', autoRemove: true },
});

runProviderTestSuite({
  name: 'docker',
  provider: dockerPython,
  supportsFilesystem: true,
  skipIntegration,
});

runProviderTestSuite({
  name: 'docker',
  provider: dockerNode,
  supportsFilesystem: true,
  skipIntegration,
});
