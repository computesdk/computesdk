import type { NorthflankConfig } from '../utils';

const env = process.env;

/** Live credentials; NORTHFLANK_API_TOKEN is accepted as an alias of NORTHFLANK_TOKEN. */
export const liveToken = env.NORTHFLANK_TOKEN || env.NORTHFLANK_API_TOKEN;
export const liveProjectId = env.NORTHFLANK_PROJECT_ID;
export const skipLive = !liveToken || !liveProjectId;

export function liveConfig(extra: Partial<NorthflankConfig> = {}): NorthflankConfig {
  return {
    token: liveToken!,
    projectId: liveProjectId!,
    ...(env.NORTHFLANK_TEAM_ID ? { teamId: env.NORTHFLANK_TEAM_ID } : {}),
    ...(env.NORTHFLANK_API_URL ? { host: env.NORTHFLANK_API_URL } : {}),
    ...extra,
  };
}
