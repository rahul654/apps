/** Decode QR codes from a video frame: BarcodeDetector where available, else jsQR (lazy-loaded). */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

let detectorPromise: Promise<BarcodeDetectorLike | null> | null = null;
function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  detectorPromise ??= (async () => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) return null;
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
      return formats.includes('qr_code') ? new Ctor({ formats: ['qr_code'] }) : null;
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

type JsQR = typeof import('jsqr').default;
let jsqrPromise: Promise<JsQR> | null = null;
const loadJsQR = () => (jsqrPromise ??= import('jsqr').then((m) => m.default));

export async function scanVideoFrame(video: HTMLVideoElement, scratch: HTMLCanvasElement): Promise<string | null> {
  const w0 = video.videoWidth;
  const h0 = video.videoHeight;
  if (!w0 || !h0) return null;
  const native = await nativeDetector();
  if (native) {
    try {
      const codes = await native.detect(video);
      return codes[0]?.rawValue ?? null;
    } catch {
      /* fall back to jsQR */
    }
  }
  const jsQR = await loadJsQR();
  const scale = Math.min(1, 800 / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  // Laptop webcams show a mirrored preview, but the stream itself isn't mirrored: no flip needed.
  const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
  return res?.data ?? null;
}
