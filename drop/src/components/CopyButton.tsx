import { useState } from 'react';

export function CopyButton({ text, label = 'Copy', className = 'btn' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone('Copied');
    } catch {
      setDone('Copy failed');
    }
    setTimeout(() => setDone(null), 1500);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      {done ?? label}
    </button>
  );
}
