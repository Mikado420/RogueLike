/** チャット・パーティ・ギルドの言葉（client ⇔ ChatDO） */

export type ChatChannel = 'world' | 'area' | 'party' | 'guild' | 'dm';

export interface ChatFrom { a: string; name: string; handle: string | null }

export type SocialClientMsg =
  | { t: 'say'; ch: Exclude<ChatChannel, 'area'>; text?: string; stamp?: string; to?: string }
  | { t: 'block'; id: string; on: boolean }
  | { t: 'ping' };

export interface PartyState { id: string; leader: string; members: { a: string; name: string; level: number }[]; open: boolean; goal: string | null }
export interface GuildState { id: string; name: string; members: { a: string; name: string; role: 'master' | 'officer' | 'member' }[]; base: { levels: Record<string, number>; paidDay: number } }

export type SocialServerMsg =
  | { t: 'msg'; ch: ChatChannel; from: ChatFrom; text?: string; stamp?: string; at: number; to?: string }
  | { t: 'history'; ch: ChatChannel; list: Extract<SocialServerMsg, { t: 'msg' }>[] }
  | { t: 'party'; party: PartyState | null }
  | { t: 'guild'; guild: GuildState | null }
  | { t: 'invite'; kind: 'party' | 'guild'; id: string; from: ChatFrom; name?: string }
  | { t: 'notice'; key: string; args?: (string | number)[] }
  | { t: 'blocks'; list: string[] }
  | { t: 'error'; code: string }
  | { t: 'pong' };
