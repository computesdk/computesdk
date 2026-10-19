// Where `rgstr` keeps its login and settings: ~/.rgstr (RGSTR_HOME overrides).
// Separate from ~/.benchsdk so a `compute` login and an `rgstr` login never
// clobber each other.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Credentials {
  /** The rgstr origin the login was made against (never sent elsewhere). */
  baseUrl: string;
  token: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  clientId: string;
  /** Authorization server (…/api/auth) and resource discovered at login. */
  authBaseUrl: string;
  resource: string;
}

export interface Config {
  org?: string;
  baseUrl?: string;
}

export function rgstrHome(): string {
  return process.env.RGSTR_HOME || path.join(os.homedir(), '.rgstr');
}

const credentialsPath = () => path.join(rgstrHome(), 'credentials.json');
const configPath = () => path.join(rgstrHome(), 'config.json');

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export const loadCredentials = () => readJson<Credentials>(credentialsPath());
export const saveCredentials = (c: Credentials) => writeJson(credentialsPath(), c);
export async function clearCredentials(): Promise<void> {
  await fs.rm(credentialsPath(), { force: true });
}

export const loadConfig = async () => (await readJson<Config>(configPath())) ?? {};
export const saveConfig = (c: Config) => writeJson(configPath(), c);
