/**
 * Trim and convert with Mediabunny (WebCodecs-based demux / mux / transcode).
 * Imported only via `import('./editor')`, so the library lives in its own lazy chunk.
 *
 * Trim:
 *  - "fast": copies encoded packets (no re-encode). The cut snaps back to the key frame at or
 *    before the chosen start, so the clip may begin up to one key-frame interval early.
 *  - "precise": frame-accurate; video is re-encoded (slower, needs WebCodecs encoders).
 * Convert: WebM → MP4 (H.264 + AAC, or Opus when AAC can't be encoded) and MP4 → WebM (VP9/VP8 + Opus).
 *
 * Output is streamed to a temporary file in the Origin Private File System when available,
 * so long clips aren't buffered in memory; otherwise to an in-memory buffer.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  OGG,
  OggOutputFormat,
  Output,
  QTFF,
  QUALITY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type OutputFormat,
  type StreamTargetChunk,
  type Target,
  type VideoCodec,
} from 'mediabunny';

export type Container = 'mp4' | 'webm' | 'ogg' | 'other';

export interface ProbeInfo {
  container: Container;
  duration: number;
  video: { codec: VideoCodec | null; width: number; height: number; canDecode: boolean } | null;
  audio: { codec: AudioCodec | null; canDecode: boolean } | null;
}

export interface EditCapabilities {
  canTrim: boolean;
  /** Frame-accurate trim needs a decoder and an encoder for the video codec. */
  preciseTrim: boolean;
  toMp4: { video: VideoCodec | null; audio: AudioCodec | null } | null;
  toWebm: { video: VideoCodec | null; audio: AudioCodec | null } | null;
  reason?: string;
}

export interface EditResult {
  blob: Blob;
  mimeType: string;
  /** Actual output start / duration (s). */
  duration: number;
  /** Whether any track was re-encoded. */
  transcoded: boolean;
}

function openInput(blob: Blob) {
  return new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
}

async function containerOf(input: Input): Promise<Container> {
  const f = await input.getFormat();
  if (f === MP4 || f === QTFF) return 'mp4';
  if (f === OGG) return 'ogg';
  if (/webm|matroska/i.test(f.mimeType)) return 'webm';
  return 'other';
}

export async function probe(blob: Blob): Promise<ProbeInfo> {
  const input = openInput(blob);
  try {
    const [container, v, a] = await Promise.all([containerOf(input), input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const duration = await input.computeDuration();
    return {
      container,
      duration,
      video: v ? { codec: v.codec, width: v.displayWidth, height: v.displayHeight, canDecode: await v.canDecode() } : null,
      audio: a ? { codec: a.codec, canDecode: await a.canDecode() } : null,
    };
  } finally {
    input.dispose();
  }
}

export async function capabilities(info: ProbeInfo): Promise<EditCapabilities> {
  if (info.container === 'other') return { canTrim: false, preciseTrim: false, toMp4: null, toWebm: null, reason: 'Unsupported file format' };
  const hasV = !!info.video;
  const hasA = !!info.audio;
  const decodable = (!hasV || info.video!.canDecode) && (!hasA || info.audio!.canDecode);
  const size = info.video ? { width: info.video.width, height: info.video.height } : undefined;

  const target = async (videoCodecs: VideoCodec[], audioCodecs: AudioCodec[]) => {
    if (!decodable) return null;
    const video = hasV ? await getFirstEncodableVideoCodec(videoCodecs, size) : null;
    const audio = hasA ? await getFirstEncodableAudioCodec(audioCodecs) : null;
    if ((hasV && !video) || (hasA && !audio)) return null;
    return { video, audio };
  };

  return {
    // Fast trims only copy packets; precise trims need decode + encode, checked at run time.
    canTrim: true,
    preciseTrim: !hasV || (decodable && !!info.video!.codec && !!(await getFirstEncodableVideoCodec([info.video!.codec], size))),
    toMp4: info.container === 'mp4' ? null : await target(['avc'], ['aac', 'opus']),
    toWebm: info.container === 'webm' ? null : await target(['vp9', 'vp8'], ['opus']),
  };
}

/** Timestamp (s) of the video key frame at or before `t`: where a fast trim actually starts. */
export async function keyFrameBefore(blob: Blob, t: number): Promise<number | null> {
  const input = openInput(blob);
  try {
    const v = await input.getPrimaryVideoTrack();
    if (!v) return t;
    const sink = new EncodedPacketSink(v);
    const p = (await sink.getKeyPacket(t, { metadataOnly: true })) ?? (await sink.getFirstPacket({ metadataOnly: true }));
    return p ? p.timestamp : null;
  } finally {
    input.dispose();
  }
}

async function makeTarget(): Promise<{ target: Target; result: () => Promise<Blob>; cleanup: () => Promise<void> }> {
  try {
    const getDir = navigator.storage?.getDirectory?.bind(navigator.storage);
    const proto = (globalThis as { FileSystemFileHandle?: { prototype: object } }).FileSystemFileHandle?.prototype;
    if (getDir && proto && 'createWritable' in proto) {
      const root = await getDir();
      const name = `recorder-edit-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
      const fh = await root.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      return {
        target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>),
        result: () => fh.getFile(),
        cleanup: () => root.removeEntry(name).catch(() => {}),
      };
    }
  } catch {
    /* OPFS unavailable (private mode, Safari): fall back to memory */
  }
  const target = new BufferTarget();
  return {
    target,
    result: async () => new Blob([target.buffer ?? new ArrayBuffer(0)]),
    cleanup: async () => {},
  };
}

function outputFormat(container: Container, inMemory: boolean): OutputFormat {
  if (container === 'mp4') return new Mp4OutputFormat({ fastStart: inMemory ? 'in-memory' : false });
  if (container === 'ogg') return new OggOutputFormat();
  return new WebMOutputFormat();
}

interface RunOptions {
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

async function run(
  blob: Blob,
  container: Container,
  configure: (input: Input) => Promise<Omit<Parameters<typeof Conversion.init>[0], 'input' | 'output'>>,
  opts: RunOptions,
): Promise<EditResult & { cleanup: () => Promise<void> }> {
  const input = openInput(blob);
  const sink = await makeTarget();
  const output = new Output({ format: outputFormat(container, sink.target instanceof BufferTarget), target: sink.target });
  try {
    const conversion = await Conversion.init({ input, output, showWarnings: false, ...(await configure(input)) });
    if (!conversion.isValid) {
      const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
      throw new Error(`This browser can’t process the file (${why || 'no usable tracks'}).`);
    }
    if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress!(p);
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const onAbort = () => void conversion.cancel();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
    const mimeType = await output.getMimeType();
    const file = await sink.result();
    const outBlob = file.type === mimeType ? file : new Blob([file], { type: mimeType });
    // Duration of the result, read back from the file we just wrote.
    const check = openInput(outBlob);
    const duration = await check.computeDuration().finally(() => check.dispose());
    const transcoded = conversion.utilizedTracks.length > 0 && (await wasTranscoded(input, outBlob));
    return { blob: outBlob, mimeType, duration, transcoded, cleanup: sink.cleanup };
  } catch (e) {
    await sink.cleanup();
    if (e instanceof ConversionCanceledError) throw new DOMException('Cancelled', 'AbortError');
    throw e;
  } finally {
    input.dispose();
  }
}

async function wasTranscoded(input: Input, out: Blob): Promise<boolean> {
  const o = openInput(out);
  try {
    const [iv, ov] = await Promise.all([input.getPrimaryVideoTrack(), o.getPrimaryVideoTrack()]);
    const [ia, oa] = await Promise.all([input.getPrimaryAudioTrack(), o.getPrimaryAudioTrack()]);
    return (iv?.codec ?? null) !== (ov?.codec ?? null) || (ia?.codec ?? null) !== (oa?.codec ?? null);
  } catch {
    return false;
  } finally {
    o.dispose();
  }
}

export async function trim(
  blob: Blob,
  range: { start: number; end: number },
  mode: 'fast' | 'precise',
  opts: RunOptions = {},
): Promise<EditResult & { cleanup: () => Promise<void> }> {
  const input = openInput(blob);
  const container = await containerOf(input).finally(() => input.dispose());
  return run(
    blob,
    container,
    async () => ({
      trim: { start: range.start, end: range.end },
      // Note: setting `quality` forces a transcode in Mediabunny, so fast mode leaves it out.
      ...(mode === 'fast'
        ? {
            // Copy from the previous key frame and shift the timeline so the file starts at 0.
            copy: { mode: 'preferred', boundaryPolicy: 'expand', shiftTolerance: Infinity, boundaryTolerance: Infinity },
          }
        : {
            // Frame-accurate: re-encode video; audio packets are short, so they're copied exactly.
            copy: { mode: 'preferred', boundaryPolicy: 'expand', shiftTolerance: 0 },
            video: { forceTranscode: true, quality: QUALITY_HIGH },
          }),
    }),
    opts,
  );
}

export async function convert(
  blob: Blob,
  to: 'mp4' | 'webm',
  codecs: { video: VideoCodec | null; audio: AudioCodec | null },
  opts: RunOptions = {},
): Promise<EditResult & { cleanup: () => Promise<void> }> {
  return run(
    blob,
    to,
    async () => ({
      video: codecs.video ? { codec: codecs.video, quality: QUALITY_HIGH } : { discard: true },
      audio: codecs.audio ? { codec: codecs.audio, quality: QUALITY_HIGH } : { discard: true },
    }),
    opts,
  );
}
