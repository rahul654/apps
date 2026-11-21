import { useEffect, useRef, useState } from 'react';
import { isMobile } from '../lib/device';
import { scanVideoFrame } from '../lib/qrScan';

type CameraState = 'starting' | 'on' | 'denied' | 'unavailable';

/**
 * Live camera QR scanner. Calls `onCode` for each distinct decoded value and `onReady` once the
 * camera is running or has failed (the pairing page creates its code after that, see StartPage).
 */
export function Scanner({ onCode, onReady, paused = false }: { onCode: (text: string) => void; onReady?: (ok: boolean) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const onCodeRef = useRef(onCode);
  const onReadyRef = useRef(onReady);
  const pausedRef = useRef(paused);
  const lastRef = useRef<string>('');
  const [camera, setCamera] = useState<CameraState>('starting');
  onCodeRef.current = onCode;
  onReadyRef.current = onReady;
  pausedRef.current = paused;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = (ok: boolean) => onReadyRef.current?.(ok);

    const loop = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      if (!pausedRef.current && !document.hidden && video.readyState >= 2) {
        scratch.current ??= document.createElement('canvas');
        try {
          const text = await scanVideoFrame(video, scratch.current);
          if (text && text !== lastRef.current && !stopped) {
            lastRef.current = text;
            onCodeRef.current(text);
            // Let the same code be read again later (e.g. after an error was fixed).
            setTimeout(() => (lastRef.current = ''), 3000);
          }
        } catch {
          /* a bad frame; try the next one */
        }
      }
      if (!stopped) timer = setTimeout(loop, 150);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('unavailable');
        return ready(false);
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: isMobile() ? 'environment' : 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (stopped) return;
        setCamera((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return ready(false);
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCamera('on');
      ready(true);
      void loop();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted className={isMobile() ? '' : 'mirror'} aria-label="Camera preview for scanning a QR code" />
      {camera !== 'on' && (
        <div className="scanner-msg small">
          {camera === 'starting' && 'Starting the camera…'}
          {camera === 'denied' && 'Camera access was blocked. Allow it in the address bar, or paste the code below.'}
          {camera === 'unavailable' && 'No camera available. Paste the code below instead.'}
        </div>
      )}
      {camera === 'on' && <div className="scanner-frame" aria-hidden="true" />}
    </div>
  );
}
