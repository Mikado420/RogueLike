import type { CharacterData, Command, GameEvent, InstanceSpec } from '../state';

/** WebSocket に入るためのチケット（サーバーが HMAC で署名する） */
export interface Ticket {
  /** アカウント id */
  a: string;
  /** キャラ id */
  c: string;
  /** セッション id（ログインごと） */
  s: string;
  /** セッションの世代（二重ログインで古いものを無効にする） */
  e: number;
  /** 入る AreaDO / InstanceDO の名前 */
  k: string;
  /** 出る場所（座標か出現位置の名前） */
  at?: { x: number; y: number } | string | null;
  /** インスタンスを作る指定 */
  inst?: InstanceSpec;
  /** 救援で入る */
  r?: 1;
  exp: number;
}

/** 入力1つ（連番つき） */
export interface InputMsg {
  t: 'in';
  /** 連番 */
  n: number;
  /** 移動 [x, y]（ワールド座標、長さ 0〜1） */
  m: [number, number];
  /** 狙い */
  a: [number, number] | null;
  /** 攻撃・回避・調べる（ビット） */
  b: number;
  /** スキル枠（-1 なし） */
  k: number;
  /** コマンド */
  c?: Command[];
}

export const BTN_ATTACK = 1, BTN_DODGE = 2, BTN_INTERACT = 4;

export type ClientMsg =
  | InputMsg
  | { t: 'ping'; at: number }
  | { t: 'bye' };

/** スナップショットの中の1体（そのまま World の配列に入る形） */
export type EntityState = Record<string, unknown> & { id: number };

export interface SnapshotMsg {
  t: 'snap';
  tick: number;
  clock: number;
  /** 最後に処理した入力の連番 */
  ack: number;
  /** 変わったものだけ（種類ごと） */
  pl?: EntityState[];
  mo?: EntityState[];
  pe?: EntityState[];
  dr?: EntityState[];
  st?: EntityState[];
  pr?: EntityState[];
  nd?: EntityState[];
  np?: EntityState[];
  /** 見えなくなったもの */
  gone?: number[];
  /** エリアの状態（インスタンス・侵攻・安全地帯など）が変わったとき */
  area?: Record<string, unknown>;
  ev?: GameEvent[];
}

export type ServerMsg =
  | { t: 'welcome'; you: number; key: string; area: string; tick: number; clock: number; tickRate: number; snapshotRate: number; inputRate: number;
      interest: number; map?: unknown; spec?: InstanceSpec | null; sid: string;
      /** 切れたときにつなぎ直すためのチケット */
      resume: string }
  | SnapshotMsg
  | { t: 'char'; char: CharacterData; account: Record<string, unknown> }
  | { t: 'move'; key: string; ticket: string }
  | { t: 'kick'; reason: string }
  | { t: 'pong'; at: number; server: number }
  | { t: 'notice'; key: string; args?: (string | number)[]; world?: boolean; rare?: boolean };

/** HTTP API で返すキャラの要約 */
export interface CharSummary { id: string; name: string; level: number; rebirths: number; area: string; look: { body: number; hair: number } }
