import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code as an SVG image. Medium error correction: robust to glare, still a small code. */
export function QrCode({ value, label, size = 280 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then((svg) => !cancelled && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {src ? <img src={src} alt={label} width={size} height={size} /> : <span className="muted small">Making code…</span>}
    </div>
  );
}
