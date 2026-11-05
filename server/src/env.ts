/** Worker と Durable Object に渡される束縛（wrangler.jsonc） */
export interface Env {
  AREA: DurableObjectNamespace;
  INSTANCE: DurableObjectNamespace;
  ACCOUNT: DurableObjectNamespace;
  WORLD: DurableObjectNamespace;
  CHAT: DurableObjectNamespace;
  PARTY: DurableObjectNamespace;
  GUILD: DurableObjectNamespace;
  MARKET: DurableObjectNamespace;
  DB: D1Database;
  SESSION_SECRET: string;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  /** 設定の上書き（JSON。例：{"tickRate":10}） */
  CONFIG?: string;
  /** テスト用：tick を自動で回さない */
  TICK_MODE?: 'interval' | 'manual';
}
