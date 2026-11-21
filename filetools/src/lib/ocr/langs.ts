/**
 * OCR languages: which traineddata to load and from where. Pure (tested).
 *
 * - Fast model (default): tessdata_fast. English and Hindi are bundled with the app;
 *   the rest come from the official tesseract-ocr/tessdata_fast repo via jsDelivr.
 * - Best model: tessdata_best (integer-quantised "best_int" builds published by the
 *   tesseract.js project as @tesseract.js-data/*), via jsDelivr. Slower, more accurate.
 *
 * Cache keys match tesseract.js's own IndexedDB cache layout (`<cachePath>/<lang>.traineddata`,
 * cachePath = model), so its workers read the files we stored.
 */

export type OcrModel = 'fast' | 'best';

export interface OcrLanguage {
  code: string;
  name: string;
  script: string;
  /** Approximate download sizes in bytes. */
  fastBytes: number;
  bestBytes: number;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', name: 'English', script: 'Latin', fastBytes: 1_976_293, bestBytes: 2_952_873 },
  { code: 'hin', name: 'Hindi', script: 'Devanagari', fastBytes: 921_836, bestBytes: 1_389_692 },
  { code: 'mar', name: 'Marathi', script: 'Devanagari', fastBytes: 2_118_233, bestBytes: 1_966_154 },
  { code: 'ben', name: 'Bengali', script: 'Bengali', fastBytes: 855_841, bestBytes: 1_373_429 },
  { code: 'tam', name: 'Tamil', script: 'Tamil', fastBytes: 3_237_963, bestBytes: 1_446_167 },
  { code: 'tel', name: 'Telugu', script: 'Telugu', fastBytes: 2_769_654, bestBytes: 1_735_518 },
  { code: 'guj', name: 'Gujarati', script: 'Gujarati', fastBytes: 1_418_394, bestBytes: 1_219_824 },
  { code: 'kan', name: 'Kannada', script: 'Kannada', fastBytes: 3_608_331, bestBytes: 1_914_250 },
  { code: 'mal', name: 'Malayalam', script: 'Malayalam', fastBytes: 5_275_996, bestBytes: 2_794_667 },
  { code: 'pan', name: 'Punjabi', script: 'Gurmukhi', fastBytes: 497_721, bestBytes: 1_396_216 },
  { code: 'urd', name: 'Urdu', script: 'Arabic', fastBytes: 1_398_718, bestBytes: 1_023_740 },
  { code: 'ara', name: 'Arabic', script: 'Arabic', fastBytes: 1_432_056, bestBytes: 1_661_906 },
  { code: 'fra', name: 'French', script: 'Latin', fastBytes: 1_130_365, bestBytes: 707_406 },
  { code: 'deu', name: 'German', script: 'Latin', fastBytes: 1_525_436, bestBytes: 1_333_102 },
  { code: 'spa', name: 'Spanish', script: 'Latin', fastBytes: 2_294_433, bestBytes: 2_100_190 },
  { code: 'por', name: 'Portuguese', script: 'Latin', fastBytes: 1_982_756, bestBytes: 1_392_239 },
  { code: 'ita', name: 'Italian', script: 'Latin', fastBytes: 2_701_314, bestBytes: 1_660_998 },
  { code: 'rus', name: 'Russian', script: 'Cyrillic', fastBytes: 3_861_738, bestBytes: 2_679_598 },
  { code: 'chi_sim', name: 'Chinese (Simplified)', script: 'Han', fastBytes: 2_469_156, bestBytes: 1_718_768 },
  { code: 'chi_tra', name: 'Chinese (Traditional)', script: 'Han', fastBytes: 2_366_642, bestBytes: 1_656_239 },
  { code: 'jpn', name: 'Japanese', script: 'Japanese', fastBytes: 2_471_260, bestBytes: 2_030_256 },
  { code: 'kor', name: 'Korean', script: 'Hangul', fastBytes: 1_677_415, bestBytes: 1_572_336 },
];

/** Languages shipped inside the app (fast model only). */
export const BUNDLED_FAST = ['eng', 'hin'] as const;

export const REMOTE_HOST = 'cdn.jsdelivr.net';
export const FAST_REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0';
export const BEST_REMOTE_BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

export interface LangAsset {
  code: string;
  model: OcrModel;
  source: 'bundled' | 'remote';
  url: string;
  bytes: number;
  /** IndexedDB key, as read by tesseract.js workers with cachePath = model. */
  cacheKey: string;
}

export function cacheKeyFor(code: string, model: OcrModel): string {
  return `${model}/${code}.traineddata`;
}

export function languageByCode(code: string): OcrLanguage | undefined {
  return OCR_LANGUAGES.find((l) => l.code === code);
}

/**
 * Resolve the selected languages to downloadable assets. `bundledUrls` maps bundled
 * language codes to their (relative) asset URLs.
 */
export function resolveLangAssets(codes: string[], model: OcrModel, bundledUrls: Partial<Record<string, string>>): LangAsset[] {
  const seen = new Set<string>();
  const out: LangAsset[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    const lang = languageByCode(code);
    if (!lang) throw new Error(`Unknown OCR language: ${code}`);
    seen.add(code);
    const bundled = model === 'fast' ? bundledUrls[code] : undefined;
    const url = bundled
      ? bundled
      : model === 'fast'
        ? `${FAST_REMOTE_BASE}/${code}.traineddata`
        : `${BEST_REMOTE_BASE}/${code}/4.0.0_best_int/${code}.traineddata.gz`;
    out.push({ code, model, source: bundled ? 'bundled' : 'remote', url, bytes: model === 'fast' ? lang.fastBytes : lang.bestBytes, cacheKey: cacheKeyFor(code, model) });
  }
  return out;
}

/** tesseract.js language string, e.g. "eng+hin". */
export function langString(codes: string[]): string {
  return [...new Set(codes)].join('+');
}

export function parseCacheKey(key: string): { model: OcrModel; code: string } | null {
  const m = /^(fast|best)\/([a-z_]+)\.traineddata$/.exec(key);
  return m ? { model: m[1] as OcrModel, code: m[2] } : null;
}
