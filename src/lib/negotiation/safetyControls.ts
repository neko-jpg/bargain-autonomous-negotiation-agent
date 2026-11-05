import { getDatabasePool } from '@/lib/negotiation/persistence';

/**
 * Global kill switch. When engaged, agents cannot take autonomous steps and
 * the Commit Gate refuses every irreversible effect. Humans can still pause,
 * stop and reject.
 *
 * Sources (any one engages it): the BARGAIN_KILL_SWITCH=engaged environment
 * variable (deploy-time, cannot be released from the app), or the operator
 * toggle stored in `safety_controls` (or process memory without a database).
 */

export interface KillSwitchState {
  engaged: boolean;
  source: 'environment' | 'operator' | 'none';
  updatedBy?: string;
  updatedAt?: string;
}

const memory = globalThis as typeof globalThis & { __bargainKillSwitch?: { engaged: boolean; updatedBy?: string; updatedAt?: string } };

function environmentEngaged() {
  return String(process.env.BARGAIN_KILL_SWITCH ?? '').trim().toLowerCase() === 'engaged';
}

export async function getKillSwitchState(): Promise<KillSwitchState> {
  if (environmentEngaged()) return { engaged: true, source: 'environment' };
  const database = getDatabasePool();
  if (database) {
    const result = await database.query("select value, updated_by, updated_at from safety_controls where key = 'kill_switch'");
    const row = result.rows[0];
    if (row && row.value === 'engaged') {
      return { engaged: true, source: 'operator', updatedBy: row.updated_by ?? undefined, updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined };
    }
    return { engaged: false, source: 'none' };
  }
  const state = memory.__bargainKillSwitch;
  return state?.engaged
    ? { engaged: true, source: 'operator', updatedBy: state.updatedBy, updatedAt: state.updatedAt }
    : { engaged: false, source: 'none' };
}

export async function isKillSwitchEngaged() {
  return (await getKillSwitchState()).engaged;
}

export async function setKillSwitch(engaged: boolean, updatedBy: string) {
  const updatedAt = new Date().toISOString();
  const database = getDatabasePool();
  if (database) {
    await database.query(
      `insert into safety_controls (key, value, updated_by, updated_at) values ('kill_switch', $1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [engaged ? 'engaged' : 'released', updatedBy, new Date(updatedAt)]
    );
  } else {
    memory.__bargainKillSwitch = { engaged, updatedBy, updatedAt };
  }
  return getKillSwitchState();
}
