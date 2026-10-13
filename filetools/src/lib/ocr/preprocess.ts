/** Image preprocessing for OCR. Pure maths on pixel arrays (tested in Node). */

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** ITU-R BT.601 luma; transparent pixels count as white (scans/screenshots on white). */
export function toGrayscale(img: Rgba): Uint8ClampedArray {
  const { data } = img;
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const a = data[i + 3] / 255;
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    out[j] = Math.round(y * a + 255 * (1 - a));
  }
  return out;
}

export function histogram(gray: Uint8ClampedArray): number[] {
  const h = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}

/** Otsu's method: the threshold maximising between-class variance. Pixels ≤ t are "ink". */
export function otsuThreshold(hist: number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return 127;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

/** Stretch contrast so the `clip` darkest/lightest fraction maps to 0/255. */
export function contrastStretch(gray: Uint8ClampedArray, clip = 0.01): Uint8ClampedArray {
  const hist = histogram(gray);
  const n = gray.length;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > n * clip) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > n * clip) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) return gray.slice();
  const out = new Uint8ClampedArray(n);
  const k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) out[i] = (gray[i] - lo) * k;
  return out;
}

export function binarize(gray: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= threshold ? 0 : 255;
  return out;
}

export function grayToRgba(gray: Uint8ClampedArray, width: number, height: number): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    data[j] = data[j + 1] = data[j + 2] = gray[i];
    data[j + 3] = 255;
  }
  return { data, width, height };
}

export interface PreprocessOptions {
  grayscale: boolean;
  contrast: boolean;
  binarize: boolean;
}

/** Apply the enabled steps in order: grayscale → contrast → Otsu binarisation. */
export function preprocessPixels(img: Rgba, opts: PreprocessOptions): { image: Rgba; threshold?: number } {
  if (!opts.grayscale && !opts.contrast && !opts.binarize) return { image: img };
  let gray = toGrayscale(img);
  if (opts.contrast) gray = contrastStretch(gray);
  let threshold: number | undefined;
  if (opts.binarize) {
    threshold = otsuThreshold(histogram(gray));
    gray = binarize(gray, threshold);
  }
  return { image: grayToRgba(gray, img.width, img.height), threshold };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Tesseract works best with text ~20–40 px tall. Given the median word height (px)
 * from a first pass, the integer factor to upscale by (1 = leave as is).
 */
export function upscaleFactor(medianTextHeight: number, minHeight = 20, target = 32, maxFactor = 4): number {
  if (!(medianTextHeight > 0) || medianTextHeight >= minHeight) return 1;
  return Math.min(maxFactor, Math.max(2, Math.ceil(target / medianTextHeight)));
}

/** Also limit by pixel budget so we never allocate a huge canvas. */
export function clampFactor(width: number, height: number, factor: number, maxPixels = 16_000_000): number {
  let f = factor;
  while (f > 1 && width * f * height * f > maxPixels) f--;
  return f;
}

/** Pick the rotation whose trial OCR looks best (confidence weighted by recognised characters). */
export function bestRotation(trials: { rotation: 0 | 90 | 180 | 270; confidence: number; chars: number }[]): 0 | 90 | 180 | 270 {
  let best = trials[0];
  const score = (t: (typeof trials)[number]) => t.confidence * Math.log(1 + t.chars);
  for (const t of trials) if (score(t) > score(best)) best = t;
  return best?.rotation ?? 0;
}
