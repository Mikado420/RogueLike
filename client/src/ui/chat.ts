import { CONTENT, txt, type ChatChannel, type ChatMessage, type OnlineServices } from '../../../shared/src';
import type { SocialClient } from '../net/social';
import { btn, h } from './dom';
import type { Ctx } from './ctx';

const CHANNELS: Exclude<ChatChannel, never>[] = ['world', 'area', 'party', 'guild', 'dm'];

/**
 * 画面のチャット欄。全体・エリア・パーティ・ギルド・個人。スタンプとエモート。
 * 名前を押すと、個人あて・ブロック・通報。
 */
export class ChatPanel {
  root: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private ch: ChatChannel = 'area';
  private toInput: HTMLInputElement;
  private chBtns = new Map<string, HTMLButtonElement>();
  private extra: HTMLDivElement;
  private open = false;
  private menu: HTMLDivElement | null = null;

  constructor(private ctx: Ctx, private social: SocialClient | null, private online: OnlineServices) {
    this.root = h('div', 'chat');
    const toggle = h('button', 'pill chat-toggle', txt('chat.title'));
    toggle.addEventListener('click', () => this.setOpen(!this.open));
    document.querySelector('#ui .top-buttons')?.prepend(toggle);
    this.log = h('div', 'chat-log');
    const chans = h('div', 'chat-chans');
    for (const c of CHANNELS) {
      const b = btn(txt(`chat.ch.${c}`), () => this.setChannel(c), 'chat-ch');
      this.chBtns.set(c, b);
      chans.append(b);
    }
    const row = h('div', 'chat-row');
    this.toInput = h('input', 'chat-to');
    this.toInput.placeholder = txt('account.handle');
    this.toInput.maxLength = 16;
    this.input = h('input', 'chat-input');
    this.input.maxLength = CONTENT.social.chat.maxLen;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.send(); }
      if (e.key === 'Escape') { this.input.blur(); }
    });
    row.append(this.toInput, this.input, btn(txt('chat.send'), () => this.send(), 'mini'), btn('☺', () => this.extra.classList.toggle('show'), 'mini'));
    this.extra = h('div', 'chat-extra');
    for (const s of CONTENT.social.chat.stamps) this.extra.append(btn(s.text, () => this.stamp(s.id), 'mini stamp'));
    for (const e of CONTENT.social.chat.emotes) this.extra.append(btn(e.text, () => { this.ctx.send({ type: 'emote', emote: e.id }); }, 'mini emote'));
    this.root.append(this.log, chans, row, this.extra);
    document.getElementById('ui')!.append(this.root);
    this.setChannel('area');
    this.setOpen(!document.body.classList.contains('touch'));
    if (social) {
      social.onMessage = (m) => this.add(m);
      for (const m of social.messages) this.add(m);
    }
  }

  setOpen(v: boolean) {
    this.open = v;
    this.root.classList.toggle('show', v);
  }

  focus() {
    this.setOpen(true);
    setTimeout(() => this.input.focus(), 0);
  }

  private setChannel(c: ChatChannel) {
    this.ch = c;
    for (const [k, b] of this.chBtns) b.classList.toggle('on', k === c);
    this.toInput.style.display = c === 'dm' ? '' : 'none';
  }

  private send() {
    const text = this.input.value.trim();
    if (!text) return;
    if (this.ch === 'area') this.ctx.send({ type: 'say', text });
    else void this.online.chat.send(this.ch, { text, to: this.ch === 'dm' ? this.toInput.value.trim() : undefined });
    this.input.value = '';
  }

  private stamp(id: string) {
    const s = CONTENT.social.chat.stamps.find((x) => x.id === id)!;
    if (this.ch === 'area') this.ctx.send({ type: 'say', text: s.text });
    else void this.online.chat.send(this.ch, { stamp: id, to: this.ch === 'dm' ? this.toInput.value.trim() : undefined });
    this.extra.classList.remove('show');
  }

  /** 1行足す */
  add(m: ChatMessage) {
    const row = h('div', `chat-line ch-${m.ch}`);
    const tag = h('span', 'chat-tag', txt(`chat.ch.${m.ch}`));
    const who = h('button', 'chat-who', m.from.name);
    who.addEventListener('click', (e) => { e.stopPropagation(); this.showMenu(m, who); });
    const stamp = m.stamp ? CONTENT.social.chat.stamps.find((s) => s.id === m.stamp)?.text : null;
    row.append(tag, who, h('span', stamp ? 'chat-text stamp' : 'chat-text', stamp ?? m.text ?? ''));
    this.log.append(row);
    while (this.log.childElementCount > 80) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    this.root.classList.add('flash');
    setTimeout(() => this.root.classList.remove('flash'), 300);
  }

  /** エリアの中の会話（スナップショットのイベントから） */
  addArea(name: string, text: string) {
    this.add({ ch: 'area', from: { a: '', name, handle: null }, text, at: Date.now() });
  }

  private showMenu(m: ChatMessage, anchor: HTMLElement) {
    this.menu?.remove();
    if (!m.from.a) return;
    const box = h('div', 'chat-menu');
    if (m.from.handle) box.append(btn(txt('chat.ch.dm'), () => { this.setChannel('dm'); this.toInput.value = m.from.handle!; this.menu?.remove(); this.focus(); }, 'mini'));
    const blocked = this.social?.blocks.includes(m.from.a);
    box.append(btn(blocked ? txt('chat.unblock') : txt('chat.block'), () => { void this.online.chat.block(m.from.a, !blocked); this.menu?.remove(); }, 'mini'));
    box.append(btn(txt('chat.report'), () => { void this.online.chat.report(m.from.a, 'chat', m.text ?? m.stamp); this.menu?.remove(); this.ctx.hud.toast(txt('chat.reported'), '#9fe8ff'); }, 'mini danger'));
    const r = anchor.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 4}px`;
    document.body.append(box);
    this.menu = box;
    setTimeout(() => window.addEventListener('pointerdown', () => { this.menu?.remove(); this.menu = null; }, { once: true }), 0);
  }

  destroy() {
    this.menu?.remove();
    this.root.remove();
    document.querySelector('.chat-toggle')?.remove();
  }
}
