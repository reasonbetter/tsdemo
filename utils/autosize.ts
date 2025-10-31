export function autosizeGrowOnly(el: HTMLTextAreaElement, maxLines = 6): void {
  if (!el) return;
  const computed = window.getComputedStyle(el);
  const lineHeight = parseFloat(computed.lineHeight || '0') || 0;
  const padding = parseFloat(computed.paddingTop || '0') + parseFloat(computed.paddingBottom || '0');
  const border = parseFloat(computed.borderTopWidth || '0') + parseFloat(computed.borderBottomWidth || '0');
  const maxPx = Math.max(0, (maxLines * lineHeight) + padding + border);
  el.style.maxHeight = `${maxPx}px`;
  el.style.overflowY = 'auto';

  // Grow-only: do not reduce height when content shrinks
  const target = Math.min(el.scrollHeight, maxPx);
  if (target > el.clientHeight) {
    el.style.height = `${target}px`;
  }
}

