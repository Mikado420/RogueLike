import type { OnlineResult, OnlineServices, PartyState, GuildState, RecruitEntry, RescueEntry, BuildRow, Visibility } from '../../../shared/src';
import { api, ApiError } from './api';
import type { SocialClient } from './social';

async function wrap<T>(fn: () => Promise<T>): Promise<OnlineResult<T>> {
  try { return { ok: true, value: await fn() }; } catch (e) {
    return { ok: false, reason: e instanceof ApiError && e.status === 0 ? 'offline' : 'error', message: e instanceof ApiError ? e.code : 'error' };
  }
}

/** オンライン用の窓口の実装（HTTP API とチャットの受け口） */
export function createOnline(social: SocialClient, charId: string): OnlineServices {
  const done = <T>(fn: () => Promise<T>) => wrap(async () => { const v = await fn(); await social.refresh(); return v; });
  return {
    status: () => ({ online: true }),
    party: {
      get: () => wrap(async () => (await api.get<{ party: PartyState | null }>('/api/party')).party),
      create: () => done(async () => (await api.post<{ party: PartyState }>('/api/party/create', { charId })).party),
      invite: (handle) => wrap(async () => { await api.post('/api/party/invite', { handle, charId }); }),
      join: (id) => done(async () => (await api.post<{ party: PartyState }>('/api/party/join', { id, charId })).party),
      leave: (a) => done(async () => { await api.post('/api/party/leave', { a }); }),
      setOpen: (open, goal) => done(async () => { await api.post('/api/party/open', { open, goal, charId }); }),
      recruits: () => wrap(async () => (await api.get<{ list: RecruitEntry[] }>('/api/recruit')).list),
    },
    chat: {
      send: async (ch, body) => (social.send({ t: 'say', ch, ...body }) ? { ok: true, value: undefined } : { ok: false, reason: 'offline' }),
      recent: () => social.messages,
      block: async (id, on) => (social.send({ t: 'block', id, on }) ? { ok: true, value: undefined } : { ok: false, reason: 'offline' }),
      report: (target, reason, text) => wrap(async () => { await api.post('/api/report', { target, reason, text }); }),
    },
    market: {
      search: (q) => wrap(async () => (await api.get<{ list: unknown[] }>(`/api/market?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`)).list),
      list: () => wrap(async () => { throw new ApiError(400, 'useArea'); }),
      buy: (id) => wrap(async () => { await api.post('/api/market/buy', { id }); }),
      cancel: (id) => wrap(async () => { await api.post('/api/market/cancel', { id }); }),
    },
    rescue: {
      list: () => wrap(async () => (await api.get<{ list: RescueEntry[] }>('/api/rescue')).list),
      join: (id) => wrap(async () => { await api.post('/api/rescue/join', { id }); }),
    },
    builds: {
      publish: (cid, vis: Visibility) => wrap(async () => { await api.post('/api/builds/publish', { charId: cid, visibility: vis }); }),
      search: (q) => wrap(async () => (await api.get<{ list: BuildRow[] }>(`/api/builds?q=${encodeURIComponent(q)}`)).list),
      view: (cid) => wrap(async () => (await api.get<{ card: Record<string, unknown> }>(`/api/builds/${encodeURIComponent(cid)}`)).card),
    },
    guild: {
      get: () => wrap(async () => (await api.get<{ guild: GuildState | null }>('/api/guild')).guild),
      create: (name) => done(async () => (await api.post<{ guild: GuildState }>('/api/guild/create', { name, charId })).guild),
      invite: (handle) => wrap(async () => { await api.post('/api/guild/invite', { handle, charId }); }),
      join: (id) => done(async () => (await api.post<{ guild: GuildState }>('/api/guild/join', { id, charId })).guild),
      leave: (a) => done(async () => { await api.post('/api/guild/leave', { a }); }),
      setRole: (a, role) => done(async () => { await api.post('/api/guild/role', { a, role }); }),
    },
  };
}
