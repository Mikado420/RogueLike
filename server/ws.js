// 依存なしの最小 WebSocket サーバー（RFC 6455 のテキストフレームのみ）。
// ゲームはJSONのテキストしか送らないので、これで足りる。
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.readyState = 1;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.onData(d));
    sock.on('close', () => this.finish());
    sock.on('error', () => this.finish());
  }

  finish() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > this.maxPayload || !masked) { this.close(1009); return; }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this.frame(0xa, data); continue; } // ping → pong
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        this.fragments.push(data);
        if (fin) {
          const msg = Buffer.concat(this.fragments);
          this.fragments = [];
          this.emit('message', msg);
        }
      }
    }
  }

  frame(op, payload) {
    if (this.readyState !== 1) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(text) { this.frame(0x1, Buffer.from(text)); }

  close(code = 1000) {
    if (this.readyState !== 1) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.frame(0x8, b);
    this.readyState = 2;
    this.sock.end();
  }
}

export class WebSocketServer extends EventEmitter {
  constructor({ server, path = '/ws', maxPayload = 64 * 1024 }) {
    super();
    server.on('upgrade', (req, sock) => {
      const url = (req.url || '').split('?')[0];
      const key = req.headers['sec-websocket-key'];
      if (url !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
        sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
      this.emit('connection', new Socket(sock, maxPayload), req);
    });
  }
}
