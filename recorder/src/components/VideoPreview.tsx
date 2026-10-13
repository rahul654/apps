import { useEffect, useRef, type CSSProperties } from 'react';

/** <video> bound to a live MediaStream. Always muted (preview only, avoids feedback). */
export function VideoPreview({ stream, mirror, className, style, label }: { stream: MediaStream | null; mirror?: boolean; className?: string; style?: CSSProperties; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      className={className}
      style={{ ...style, transform: mirror ? 'scaleX(-1)' : undefined }}
      muted
      playsInline
      autoPlay
      aria-label={label}
    />
  );
}
