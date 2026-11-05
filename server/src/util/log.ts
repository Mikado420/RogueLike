/**
 * 監視のためのログ（Workers の Observability に JSON で出る）。テストでは静かにする。
 */
export const logger = {
  quiet: false,
  info(ev: string, data: Record<string, unknown> = {}) { if (!this.quiet) console.log(JSON.stringify({ ev, ...data })); },
  warn(ev: string, data: unknown = {}) {
    if (this.quiet) return;
    const f = (x: unknown) => (x instanceof Error ? x.message : x);
    console.warn(JSON.stringify({ ev, level: 'warn', data: Array.isArray(data) ? data.map(f) : f(data) }));
  },
  error(ev: string, data: unknown = {}) { console.error(JSON.stringify({ ev, level: 'error', data: data instanceof Error ? `${data.message}\n${data.stack}` : data })); },
};
