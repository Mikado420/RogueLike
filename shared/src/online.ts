/**
 * オンライン用の窓口（段階3〜でサーバーにつなぐ）。
 * いまはすべて OfflineServices が「オフライン」と返す。client はこの形だけを使う。
 */

export type OnlineResult<T> = { ok: true; value: T } | { ok: false; reason: 'offline' | 'error'; message?: string };

export interface PartyMember { id: string; name: string; level: number; weapon: string }
export interface PartyService {
  create(): Promise<OnlineResult<{ partyId: string }>>;
  invite(name: string): Promise<OnlineResult<void>>;
  leave(): Promise<OnlineResult<void>>;
  members(): Promise<OnlineResult<PartyMember[]>>;
}

export interface ChatMessage { from: string; text: string; at: number; channel: 'world' | 'party' | 'guild' }
export interface ChatService {
  send(channel: ChatMessage['channel'], text: string): Promise<OnlineResult<void>>;
  recent(channel: ChatMessage['channel']): Promise<OnlineResult<ChatMessage[]>>;
}

export interface Listing { id: string; itemUid: number; price: number; seller: string }
export interface MarketService {
  search(query: string): Promise<OnlineResult<Listing[]>>;
  list(itemUid: number, price: number): Promise<OnlineResult<{ listingId: string }>>;
  buy(listingId: string): Promise<OnlineResult<void>>;
}

export interface RescueService {
  /** ボスやダンジョンで助けを呼ぶ */
  request(where: string): Promise<OnlineResult<{ requestId: string }>>;
  open(): Promise<OnlineResult<{ requestId: string; where: string; from: string }[]>>;
}

export interface BuildViewerService {
  publish(characterId: string): Promise<OnlineResult<{ url: string }>>;
  view(name: string): Promise<OnlineResult<unknown>>;
}

export interface OnlineServices {
  status(): { online: boolean };
  party: PartyService;
  chat: ChatService;
  market: MarketService;
  rescue: RescueService;
  builds: BuildViewerService;
}

const off = async <T>(): Promise<OnlineResult<T>> => ({ ok: false, reason: 'offline' });

/** オフラインのときの窓口（どれも使えない） */
export const OfflineServices: OnlineServices = {
  status: () => ({ online: false }),
  party: { create: off, invite: off, leave: off, members: off },
  chat: { send: off, recent: off },
  market: { search: off, list: off, buy: off },
  rescue: { request: off, open: off },
  builds: { publish: off, view: off },
};
