/**
 * Copies text. Uses the async Clipboard API, falling back to a hidden textarea + execCommand where
 * it is missing or refused (older browsers, some embedded webviews).
 */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  const prev = document.activeElement as HTMLElement | null;
  ta.select();
  const ok = document.execCommand?.('copy') ?? false;
  ta.remove();
  prev?.focus?.();
  if (!ok) throw new Error('The browser blocked copying to the clipboard.');
}
