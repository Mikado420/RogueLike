import { h } from './dom';
import { txt } from '../../../shared/src';

const CANCEL_LABEL = txt('ui.cancel');

/** 画面中央のパネル（同時に1つだけ） */
export class Modal {
  private el: HTMLDivElement | null = null;
  kind: string | null = null;
  private renderFn: ((panel: HTMLDivElement) => void) | null = null;
  private title = '';
  onChange: (() => void) | null = null;

  constructor(private root: HTMLElement) {}

  get isOpen() { return this.el !== null; }

  open(kind: string, title: string, render: (panel: HTMLDivElement) => void) {
    this.close();
    this.kind = kind;
    this.title = title;
    this.renderFn = render;
    this.el = h('div', 'modal');
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    this.root.append(this.el);
    this.refresh();
    this.onChange?.();
  }

  /** 中身を描き直す（スクロール位置は残す） */
  refresh() {
    if (!this.el || !this.renderFn) return;
    const prevBody = this.el.querySelector('.panel-body');
    const scroll = prevBody ? prevBody.scrollTop : 0;
    const inner = this.el.querySelectorAll('[data-keep-scroll]');
    const innerScroll = Array.from(inner).map((e) => (e as HTMLElement).scrollTop);
    const panel = h('div', 'panel');
    const head = h('div', 'panel-head');
    head.append(h('div', 'panel-title', this.title));
    const close = h('button', 'close', '×');
    close.addEventListener('click', () => this.close());
    head.append(close);
    const body = h('div', 'panel-body');
    panel.append(head, body);
    this.renderFn(body);
    this.el.replaceChildren(panel);
    body.scrollTop = scroll;
    this.el.querySelectorAll('[data-keep-scroll]').forEach((e, i) => { (e as HTMLElement).scrollTop = innerScroll[i] ?? 0; });
  }

  /**
   * 取り返しのつかない操作の前に確かめる小窓（パネルの上に重ねる）。
   * 中身を描き直しても消えないよう、パネルとは別の要素にする
   */
  confirm(o: { title: string; body?: string; ok: string; danger?: boolean; onOk: () => void }) {
    this.root.querySelector('.confirm-back')?.remove();
    const back = h('div', 'confirm-back');
    const box = h('div', 'confirm');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(h('div', 'confirm-title', o.title));
    if (o.body) box.append(h('div', 'confirm-body', o.body));
    const row = h('div', 'confirm-row');
    const cancel = h('button', 'btn', CANCEL_LABEL);
    const ok = h('button', `btn ${o.danger ? 'danger-fill' : 'primary'}`, o.ok);
    const close = () => back.remove();
    cancel.addEventListener('click', close);
    ok.addEventListener('click', () => { close(); o.onOk(); });
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    row.append(cancel, ok);
    box.append(row);
    back.append(box);
    this.root.append(back);
    ok.focus();
  }

  setTitle(t: string) { this.title = t; }

  close() {
    this.root.querySelector('.confirm-back')?.remove();
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.kind = null;
    this.renderFn = null;
    this.onChange?.();
  }
}
