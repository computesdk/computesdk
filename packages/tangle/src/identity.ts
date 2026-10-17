import { createHash, randomUUID } from 'node:crypto';

type CreateIdentityOptions = { idempotencyKey?: string; name?: string };

// A repeated key must preserve the request body, including its default name.
export function createIdentity(options: CreateIdentityOptions = {}) {
  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  const suffix = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
  return { idempotencyKey, name: options.name ?? 'computesdk-' + suffix };
}
