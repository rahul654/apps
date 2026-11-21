import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ToolHeader } from '../../components/common';
import { DropZone } from '../../components/DropZone';
import { errorMessage, Loading, Notice } from '../../components/Feedback';
import { decodeOnMain } from '../../lib/image/runner';
import { sizeOf } from '../../lib/image/process';
import { classifyDecoded, type Decoded } from '../../lib/qrPayload';

// BarcodeDetector isn't in TypeScript's DOM lib yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | ImageBitmap): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

let detectorPromise: Promise<BarcodeDetectorLike | null> | null = null;
function getNativeDetector(): Promise<BarcodeDetectorLike | null> {
  detectorPromise ??= (async () => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) return null;
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
      if (!formats.includes('qr_code')) return null;
      return new Ctor({ formats: ['qr_code'] });
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

type JsQR = typeof import('jsqr').default;
let jsqrPromise: Promise<JsQR> | null = null;
const loadJsQR = () => (jsqrPromise ??= import('jsqr').then((m) => m.default));

/** Decode QR codes in a drawable using BarcodeDetector, falling back to jsQR. */
async function scanSource(source: HTMLVideoElement | ImageBitmap | HTMLImageElement, scratch: HTMLCanvasElement, thorough: boolean): Promise<string[]> {
  const native = await getNativeDetector();
  if (native) {
    try {
      const codes = await native.detect(source);
      if (codes.length || !thorough) return codes.map((c) => c.rawValue);
    } catch {
      /* fall through to jsQR */
    }
  }
  const jsQR = await loadJsQR();
  const w0 = source instanceof HTMLVideoElement ? source.videoWidth : sizeOf(source).width;
  const h0 = source instanceof HTMLVideoElement ? source.videoHeight : sizeOf(source).height;
  if (!w0 || !h0) return [];
  const max = thorough ? 1600 : 720;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const res = jsQR(data.data, w, h, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
  return res ? [res.data] : [];
}

function ResultCard({ result, onAgain }: { result: Decoded; onAgain?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied('Copy failed — select the text manually');
    }
  };
  const label: Record<Decoded['kind'], string> = { url: 'Link', wifi: 'Wi-Fi network', vcard: 'Contact card', email: 'Email', phone: 'Phone number', sms: 'SMS', geo: 'Location', text: 'Text' };
  return (
    <div className="card stack" aria-live="polite">
      <h2 style={{ margin: 0 }}>Found: {label[result.kind]}</h2>
      {result.kind === 'wifi' && result.wifi ? (
        <>
          <dl className="kv">
            <dt>Network</dt><dd>{result.wifi.ssid}</dd>
            <dt>Password</dt><dd className="mono">{result.wifi.password || '(none)'}</dd>
            <dt>Security</dt><dd>{result.wifi.encryption === 'nopass' ? 'Open' : result.wifi.encryption}</dd>
            {result.wifi.hidden && <><dt>Hidden</dt><dd>Yes</dd></>}
          </dl>
          <p className="tiny muted">Browsers can’t join Wi-Fi networks. Copy the password, or scan with your phone’s camera app to join directly.</p>
        </>
      ) : (
        <div className="result-box mono small">{result.text}</div>
      )}
      {result.url && (
        <p className="small">
          Link goes to: <b className="break">{result.url}</b>
          <br />
          <span className="tiny muted">Check the address before opening — QR codes are a common phishing trick.</span>
        </p>
      )}
      <div className="row">
        {result.url && (
          <a className="btn primary" href={result.url} target="_blank" rel="noopener noreferrer">Open link ↗</a>
        )}
        {result.kind === 'wifi' && result.wifi?.password && <button type="button" className="btn" onClick={() => copy(result.wifi!.password, 'Password copied')}>Copy password</button>}
        <button type="button" className="btn" onClick={() => copy(result.text, 'Copied')}>Copy text</button>
        {onAgain && <button type="button" className="btn" onClick={onAgain}>Scan again</button>}
        {copied && <span className="small ok-text" role="status">{copied}</span>}
      </div>
    </div>
  );
}

function CameraScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [result, setResult] = useState<Decoded | null>(null);

  const stop = useCallback(() => {
    if (loopRef.current !== null) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  useEffect(() => {
    const onHide = () => document.hidden && stop();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stop();
    };
  }, [stop]);

  const start = async (id?: string) => {
    setError(null);
    setResult(null);
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? 'This browser doesn’t support camera access.' : 'Camera access needs a secure (https) page.');
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setActive(true);
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setDevices(all);
      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? id ?? '');
      let last = 0;
      let scanning = false;
      const tick = async (t: number) => {
        loopRef.current = requestAnimationFrame(tick);
        if (scanning || t - last < 150 || video.readyState < 2) return;
        last = t;
        scanning = true;
        try {
          const codes = await scanSource(video, (scratch.current ??= document.createElement('canvas')), false);
          if (codes[0] && streamRef.current) {
            setResult(classifyDecoded(codes[0]));
            navigator.vibrate?.(60);
            stop();
          }
        } finally {
          scanning = false;
        }
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No camera found.'
            : name === 'NotReadableError'
              ? 'The camera is in use by another app.'
              : `Couldn’t start the camera: ${errorMessage(e)}`,
      );
      stop();
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="stack">
      <div className="video-box" style={{ display: active || starting ? undefined : 'none' }}>
        <video ref={videoRef} playsInline muted aria-label="Camera preview" />
        <div className="scan-frame" aria-hidden="true" />
      </div>
      {!active && !result && (
        <div className="card stack" style={{ alignItems: 'flex-start' }}>
          <p className="small muted">Point your camera at a QR code. The video is analysed on this device and never recorded or sent anywhere.</p>
          <button type="button" className="btn primary" onClick={() => start()} disabled={starting}>{starting ? 'Starting camera…' : '📷 Start camera'}</button>
        </div>
      )}
      {active && (
        <div className="row">
          {devices.length > 1 && (
            <label className="field grow">
              <span>Camera</span>
              <select className="input" value={deviceId} onChange={(e) => start(e.target.value)}>
                {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn" onClick={stop}>Stop camera</button>
          <span className="small muted">Scanning…</span>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {result && <ResultCard result={result} onAgain={() => start(deviceId || undefined)} />}
    </div>
  );
}

function ImageScanner() {
  const [results, setResults] = useState<Decoded[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scan = async (files: File[]) => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const img = await decodeOnMain(files[0]);
      try {
        const codes = await scanSource(img, document.createElement('canvas'), true);
        if (!codes.length) setError('No QR code found in this image. Try a sharper, closer or better-lit picture.');
        setResults([...new Set(codes)].map(classifyDecoded));
      } finally {
        if ('close' in img) img.close();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <DropZone accept="image/*" multiple={false} onFiles={scan} paste label="Drop an image or screenshot with a QR code" hint="PNG, JPEG, WebP…" />
      {busy && <Loading label="Looking for QR codes…" />}
      {error && <Notice kind="warn">{error}</Notice>}
      {results?.map((r, i) => <ResultCard key={i} result={r} />)}
    </div>
  );
}

export default function QrScanner() {
  const [mode, setMode] = useState<'camera' | 'image'>('camera');
  return (
    <>
      <ToolHeader emoji="📷" title="QR code scanner">
        Scan with your camera or from a picture. <Link to="/qr">Make a QR code instead →</Link>
      </ToolHeader>
      <div style={{ maxWidth: 680 }}>
        <div className="tabs" role="tablist" aria-label="Scan source">
          <button type="button" role="tab" aria-selected={mode === 'camera'} onClick={() => setMode('camera')}>Camera</button>
          <button type="button" role="tab" aria-selected={mode === 'image'} onClick={() => setMode('image')}>Image / screenshot</button>
        </div>
        {mode === 'camera' ? <CameraScanner /> : <ImageScanner />}
      </div>
    </>
  );
}
