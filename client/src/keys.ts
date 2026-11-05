/** キーコードを画面に出す短い名前に */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `N${code.slice(6)}`;
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter', Escape: 'Esc',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
    Tab: 'Tab', Backspace: 'BS', Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Quote: "'", Backquote: '`', Backslash: '\\',
  };
  return map[code] ?? code;
}
