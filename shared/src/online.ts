/**
 * オンライン用の窓口。client はこの形だけを使う（実装は client/src/net/online.ts、サーバーは server/）。
 * サーバーにつながらないときは OfflineServices（どれも「オフライン」）。
 */
import type { ChatChannel, GuildState, PartyState } from './net/social';

export type OnlineResult<T> = { ok: true; value: T } | { ok: false; reason: 'offline' | 'error'; message?: string };

export interface ChatMessage { ch: ChatChannel; from: { a: string; name: string; handle: string | null }; text?: string; stamp?: string; at: number; to?: string }
export interface RecruitEntry { id: string; leader: string; name: string; goal: string | null; level: number; members: number; at: number }
export interface RescueEntry { id: string; key: string; name: string; kind: string; dungeon: string; difficulty: string; level: number; floor: number; at: number }
export interface BuildRow { char_id: string; handle: string | null; name: string; level: number; weapon: string | null; visibility: string }
export type Visibility = 'public' | 'guild' | 'private';

export interface PartyService {
  get(): Promise<OnlineResult<PartyState | null>>;
  create(): Promise<OnlineResult<PartyState>>;
  invite(handle: string): Promise<OnlineResult<void>>;
  join(id: string): Promise<OnlineResult<PartyState>>;
  leave(accountId?: string): Promise<OnlineResult<void>>;
  setOpen(open: boolean, goal: string | null): Promise<OnlineResult<void>>;
  recruits(): Promise<OnlineResult<RecruitEntry[]>>;
}

export interface ChatService {
  send(ch: Exclude<ChatChannel, 'area'>, body: { text?: string; stamp?: string; to?: string }): Promise<OnlineResult<void>>;
  recent(): ChatMessage[];
  block(accountId: string, on: boolean): Promise<OnlineResult<void>>;
  report(accountId: string, reason: string, text?: string): Promise<OnlineResult<void>>;
}

export interface MarketService {
  search(q: Record<string, string | number | undefined>): Promise<OnlineResult<unknown[]>>;
  list(itemUid: number, price: number): Promise<OnlineResult<{ id: string }>>;
  buy(listingId: string): Promise<OnlineResult<void>>;
  cancel(listingId: string): Promise<OnlineResult<void>>;
}

export interface RescueService {
  list(): Promise<OnlineResult<RescueEntry[]>>;
  join(id: string): Promise<OnlineResult<void>>;
}

export interface BuildViewerService {
  publish(characterId: string, visibility: Visibility): Promise<OnlineResult<void>>;
  search(q: string): Promise<OnlineResult<BuildRow[]>>;
  view(characterId: string): Promise<OnlineResult<Record<string, unknown>>>;
}

export interface GuildService {
  get(): Promise<OnlineResult<GuildState | null>>;
  create(name: string): Promise<OnlineResult<GuildState>>;
  invite(handle: string): Promise<OnlineResult<void>>;
  join(id: string): Promise<OnlineResult<GuildState>>;
  leave(accountId?: string): Promise<OnlineResult<void>>;
  setRole(accountId: string, role: 'master' | 'officer' | 'member'): Promise<OnlineResult<void>>;
}

export interface OnlineServices {
  status(): { online: boolean };
  party: PartyService;
  chat: ChatService;
  market: MarketService;
  rescue: RescueService;
  builds: BuildViewerService;
  guild: GuildService;
}

const off = async <T>(): Promise<OnlineResult<T>> => ({ ok: false, reason: 'offline' });

/** サーバーにつながらないときの窓口（どれも使えない） */
export const OfflineServices: OnlineServices = {
  status: () => ({ online: false }),
  party: { get: off, create: off, invite: off, join: off, leave: off, setOpen: off, recruits: off },
  chat: { send: off, recent: () => [], block: off, report: off },
  market: { search: off, list: off, buy: off, cancel: off },
  rescue: { list: off, join: off },
  builds: { publish: off, search: off, view: off },
  guild: { get: off, create: off, invite: off, join: off, leave: off, setRole: off },
};
