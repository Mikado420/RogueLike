/**
 * Workers の実行環境に依存するところ（テストではここを差し替える）
 */
export const platform = {
  /** WebSocket の組を作る */
  pair(): [WebSocket, WebSocket] {
    const p = new WebSocketPair();
    return [p[0], p[1]];
  },
  /** WebSocket に切り替える応答 */
  upgrade(client: WebSocket): Response {
    return new Response(null, { status: 101, webSocket: client });
  },
  now: () => Date.now(),
};
