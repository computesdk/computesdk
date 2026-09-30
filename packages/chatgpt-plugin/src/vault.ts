/**
 * BYOK credential vault.
 *
 * Per-user provider credentials, AES-256-GCM encrypted at rest, keyed by the
 * SHA-256 of the user's plugin bearer token. Secret values never appear in MCP
 * tool results — only field names and configured/ not-configured status.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Credentials = Record<string, string>;
/** userId -> provider -> credential field -> ciphertext blob */
type Store = Record<string, Record<string, Record<string, string>>>;

const ALGO = 'aes-256-gcm';

export class CredentialVault {
  private readonly key: Buffer;
  private readonly storePath: string;
  private store: Store;

  constructor() {
    const masterKey = process.env.CREDENTIALS_MASTER_KEY;
    if (masterKey) {
      this.key = createHash('sha256').update(masterKey).digest();
    } else {
      this.key = randomBytes(32);
      // Ephemeral dev key — credentials won't survive a restart.
      console.warn(
        '[vault] CREDENTIALS_MASTER_KEY is not set; using an ephemeral key. ' +
          'Stored credentials will be unreadable after restart.'
      );
    }

    this.storePath = resolve(process.env.CREDENTIALS_STORE_PATH ?? './.data/credentials.json');
    this.store = this.load();
  }

  /** Stable, non-reversible user identity derived from the bearer token. */
  static userIdForToken(token: string): string {
    return createHash('sha256').update(`computesdk-chatgpt:${token}`).digest('hex').slice(0, 32);
  }

  setCredentials(userId: string, provider: string, credentials: Credentials): void {
    const encrypted: Record<string, string> = {};
    for (const [field, value] of Object.entries(credentials)) {
      encrypted[field] = this.encrypt(value);
    }
    this.store[userId] ??= {};
    this.store[userId][provider] = encrypted;
    this.persist();
  }

  getCredentials(userId: string, provider: string): Credentials | null {
    const entry = this.store[userId]?.[provider];
    if (!entry) return null;
    const out: Credentials = {};
    for (const [field, blob] of Object.entries(entry)) {
      try {
        out[field] = this.decrypt(blob);
      } catch {
        throw new Error(`Stored credentials for provider "${provider}" are unreadable. Re-set them.`);
      }
    }
    return out;
  }

  hasCredentials(userId: string, provider: string): boolean {
    return Boolean(this.store[userId]?.[provider]);
  }

  removeCredentials(userId: string, provider: string): boolean {
    const removed = Boolean(this.store[userId]?.[provider]);
    if (removed) {
      delete this.store[userId][provider];
      if (Object.keys(this.store[userId]).length === 0) delete this.store[userId];
      this.persist();
    }
    return removed;
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  private decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  private load(): Store {
    if (!existsSync(this.storePath)) return {};
    try {
      return JSON.parse(readFileSync(this.storePath, 'utf8')) as Store;
    } catch {
      console.warn(`[vault] Could not parse ${this.storePath}; starting with an empty store.`);
      return {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.store), { mode: 0o600 });
    renameSync(tmp, this.storePath);
  }
}
