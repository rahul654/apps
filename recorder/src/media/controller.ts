/**
 * RecorderController: owns every side effect of recording (devices, screen capture,
 * compositor, audio mixer, MediaRecorder session, PiP, title) and exposes an immutable
 * snapshot for React via subscribe / getSnapshot (useSyncExternalStore).
 *
 * Phase transitions go through the pure `recorderReducer`; this class only performs the
 * effects around them.
 */
import { mediaErrorInfo, type DeviceKind } from '../lib/errors';
import { formatDuration } from '../lib/format';
import { bubbleFraction, cornerPosition, nearestCorner, outputSize, type BubbleLayout } from '../lib/geometry';
import { audioBitrate, pickFormat, videoBitrate, type FormatChoice } from '../lib/mime';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import { initialRecState, isActive, isBusy, recorderReducer, type RecAction, type RecError, type RecState, type StopReason } from '../lib/recorderMachine';
import { recordingStore, type RecordingMeta, type RecordingStore, type RecordMode } from '../lib/recordingStore';
import { AudioMixer } from './audioMixer';
import { capTrack, getCamera, getMic, getScreen, listDevices, permissionState, stopStream, type DeviceLists } from './capture';
import { createCompositor, type Compositor, type CompositorPath } from './compositor';
import { forcedCompositor, simulateStopSharing } from './fake';
import { canRecordScreen, canUseDevices, hasMediaRecorder, isTypeSupported, requestPersistence } from './features';
import { canPip, openCameraPip, type PipHandle } from './pip';
import { RecordingSession } from './session';
import { videoThumbnail } from './thumbnail';
import { every } from './ticker';

export interface DeviceState {
  stream: MediaStream | null;
  error: RecError | null;
  starting: boolean;
}

export interface Snapshot {
  rec: RecState;
  prefs: Prefs;
  camera: DeviceState;
  mic: DeviceState;
  devices: DeviceLists;
  /** The shared screen while recording. */
  screen: MediaStream | null;
  /** Video being recorded (composited when Screen + camera), for the live preview. */
  outputStream: MediaStream | null;
  outputSize: { width: number; height: number } | null;
  compositorPath: CompositorPath | null;
  format: FormatChoice | null;
  micMuted: boolean;
  bytes: number;
  pip: PipHandle['kind'] | null;
  notices: string[];
  lastSaved: RecordingMeta | null;
}

export const needsScreen = (m: RecordMode) => m === 'screen' || m === 'screen-camera';
export const needsCamera = (m: RecordMode) => m === 'camera' || m === 'screen-camera';

const COUNTDOWN_SECONDS = 3;
const emptyDevice: DeviceState = { stream: null, error: null, starting: false };

class TaggedError extends Error {
  kind: DeviceKind;
  cause: unknown;
  constructor(kind: DeviceKind, cause: unknown) {
    super((cause as Error)?.message ?? String(cause));
    this.kind = kind;
    this.cause = cause;
    this.name = (cause as Error)?.name ?? 'Error';
  }
}

const live = (s: MediaStream | null) => !!s && s.getTracks().some((t) => t.readyState === 'live');

export class RecorderController {
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private store: RecordingStore;
  private mixer: AudioMixer | null = null;
  private compositor: Compositor | null = null;
  private session: RecordingSession | null = null;
  private recordStream: MediaStream | null = null;
  private pipHandle: PipHandle | null = null;
  private stopCountdown: (() => void) | null = null;
  private stopTicker: (() => void) | null = null;
  private previewWanted = false;
  private baseTitle = 'Recorder';
  private startToken = 0;
  private cameraToken = 0;
  private micToken = 0;

  constructor(store: RecordingStore = recordingStore()) {
    this.store = store;
    this.snap = {
      rec: initialRecState,
      prefs: loadPrefs(),
      camera: emptyDevice,
      mic: emptyDevice,
      devices: { cameras: [], mics: [] },
      screen: null,
      outputStream: null,
      outputSize: null,
      compositorPath: null,
      format: null,
      micMuted: false,
      bytes: 0,
      pip: null,
      notices: [],
      lastSaved: null,
    };
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => void this.refreshDevices());
    }
    void this.refreshDevices();
  }

  // ---------- store plumbing ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private dispatch(a: RecAction) {
    const rec = recorderReducer(this.snap.rec, a);
    if (rec !== this.snap.rec) {
      this.set({ rec });
      this.updateTitle();
    }
  }

  private notice(msg: string) {
    if (!this.snap.notices.includes(msg)) this.set({ notices: [...this.snap.notices, msg] });
  }
  dismissNotice(msg: string) {
    this.set({ notices: this.snap.notices.filter((n) => n !== msg) });
  }

  // ---------- prefs ----------
  layout(prefs = this.snap.prefs): BubbleLayout {
    return { shape: prefs.bubbleShape, size: prefs.bubbleSize, x: prefs.bubbleX, y: prefs.bubbleY, mirror: prefs.bubbleMirror, border: prefs.bubbleBorder };
  }

  /** Output frame used for bubble maths (the real one while recording, else 16:9). */
  frameSize(): { width: number; height: number } {
    return this.snap.outputSize ?? { width: 1920, height: 1080 };
  }

  updatePrefs(patch: Partial<Prefs>) {
    const prev = this.snap.prefs;
    let next = { ...prev, ...patch };
    // Changing bubble shape / size keeps it snapped to the corner it was nearest to.
    if ((patch.bubbleShape && patch.bubbleShape !== prev.bubbleShape) || (patch.bubbleSize && patch.bubbleSize !== prev.bubbleSize)) {
      const { width, height } = this.frameSize();
      const old = bubbleFraction(prev.bubbleShape, prev.bubbleSize, width, height);
      const corner = nearestCorner(prev.bubbleX, prev.bubbleY, old.fw, old.fh);
      const pos = cornerPosition(corner, next.bubbleShape, next.bubbleSize, width, height);
      next = { ...next, bubbleX: pos.x, bubbleY: pos.y };
    }
    this.set({ prefs: next });
    savePrefs(next);
    this.compositor?.setLayout(this.layout(next));
    if (patch.micGain !== undefined) this.mixer?.setMicGain(next.micGain);

    if (isBusy(this.snap.rec.phase)) return; // device / mode changes are locked while recording
    if (patch.mode && patch.mode !== prev.mode) this.syncPreviewToMode();
    if (patch.cameraId !== undefined && patch.cameraId !== prev.cameraId && this.snap.camera.stream) void this.startCamera(true);
    if (patch.micId !== undefined && patch.micId !== prev.micId && this.snap.mic.stream) void this.startMic(true);
    if (patch.micEnabled !== undefined && patch.micEnabled !== prev.micEnabled) {
      if (next.micEnabled && this.previewWanted) void this.startMic();
      if (!next.micEnabled && next.mode !== 'audio') this.stopMic();
    }
    if (patch.resolution && patch.resolution !== prev.resolution && this.snap.camera.stream && next.mode === 'camera') void this.startCamera(true);
  }

  setBubbleCorner(corner: 'tl' | 'tr' | 'bl' | 'br') {
    const { width, height } = this.frameSize();
    const p = this.snap.prefs;
    const pos = cornerPosition(corner, p.bubbleShape, p.bubbleSize, width, height);
    this.updatePrefs({ bubbleX: pos.x, bubbleY: pos.y });
  }

  // ---------- devices / preview ----------
  async refreshDevices() {
    if (!canUseDevices()) return;
    this.set({ devices: await listDevices() });
  }

  /** Starts camera / mic previews the current mode needs, if permission is already granted. */
  async autoPreview() {
    const [cam, mic] = await Promise.all([permissionState('camera'), permissionState('microphone')]);
    const p = this.snap.prefs;
    const wantCam = needsCamera(p.mode);
    const wantMic = p.micEnabled || p.mode === 'audio';
    if ((wantCam && cam === 'granted') || (wantMic && mic === 'granted')) {
      this.previewWanted = true;
      if (wantCam && cam === 'granted') void this.startCamera();
      if (wantMic && mic === 'granted') void this.startMic();
    }
  }

  /** User asked to turn on camera / mic preview. */
  async startPreview() {
    this.previewWanted = true;
    const p = this.snap.prefs;
    await Promise.all([
      needsCamera(p.mode) ? this.startCamera() : Promise.resolve(),
      p.micEnabled || p.mode === 'audio' ? this.startMic() : Promise.resolve(),
    ]);
    void this.mixer?.resume();
  }

  stopPreview() {
    if (isBusy(this.snap.rec.phase)) return;
    this.previewWanted = false;
    this.stopCamera();
    this.stopMic();
  }

  private syncPreviewToMode() {
    const p = this.snap.prefs;
    if (!needsCamera(p.mode)) this.stopCamera();
    else if (this.previewWanted) void this.startCamera();
    if (p.mode === 'audio' && this.previewWanted && !this.snap.mic.stream) void this.startMic();
  }

  async startCamera(restart = false): Promise<MediaStream> {
    if (!restart && live(this.snap.camera.stream)) return this.snap.camera.stream!;
    const token = ++this.cameraToken;
    stopStream(this.snap.camera.stream);
    this.set({ camera: { stream: null, error: null, starting: true } });
    try {
      const p = this.snap.prefs;
      const stream = await getCamera(p.cameraId, p.resolution, p.fps);
      if (token !== this.cameraToken) {
        stopStream(stream);
        return this.snap.camera.stream ?? stream;
      }
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => this.onCameraEnded(stream));
      this.set({ camera: { stream, error: null, starting: false } });
      void this.refreshDevices();
      return stream;
    } catch (e) {
      if (token === this.cameraToken) this.set({ camera: { stream: null, error: mediaErrorInfo(e, 'camera'), starting: false } });
      throw new TaggedError('camera', e);
    }
  }

  stopCamera() {
    this.cameraToken++;
    this.pipHandle?.close();
    stopStream(this.snap.camera.stream);
    this.set({ camera: emptyDevice });
  }

  private onCameraEnded(stream: MediaStream) {
    if (this.snap.camera.stream !== stream) return;
    this.set({ camera: { stream: null, error: mediaErrorInfo({ name: 'NotReadableError' }, 'camera'), starting: false } });
    this.pipHandle?.close();
    if (isActive(this.snap.rec.phase) && this.snap.prefs.mode === 'camera') void this.stop('device-lost');
    else if (isActive(this.snap.rec.phase)) this.notice('The camera stopped. The recording continues without updating the bubble.');
  }

  async startMic(restart = false): Promise<MediaStream> {
    if (!restart && live(this.snap.mic.stream)) return this.snap.mic.stream!;
    const token = ++this.micToken;
    stopStream(this.snap.mic.stream);
    this.set({ mic: { stream: null, error: null, starting: true } });
    try {
      const stream = await getMic(this.snap.prefs.micId);
      if (token !== this.micToken) {
        stopStream(stream);
        return this.snap.mic.stream ?? stream;
      }
      const mixer = this.getMixer();
      mixer.setMic(stream);
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (this.snap.mic.stream === stream) {
          this.mixer?.setMic(null);
          this.set({ mic: { stream: null, error: mediaErrorInfo({ name: 'NotReadableError' }, 'microphone'), starting: false } });
          if (isActive(this.snap.rec.phase)) this.notice('The microphone stopped. The recording continues without it.');
        }
      });
      this.set({ mic: { stream, error: null, starting: false } });
      void this.refreshDevices();
      return stream;
    } catch (e) {
      if (token === this.micToken) this.set({ mic: { stream: null, error: mediaErrorInfo(e, 'microphone'), starting: false } });
      throw new TaggedError('microphone', e);
    }
  }

  stopMic() {
    this.micToken++;
    this.mixer?.setMic(null);
    stopStream(this.snap.mic.stream);
    this.set({ mic: emptyDevice });
  }

  private getMixer(): AudioMixer {
    if (!this.mixer) {
      this.mixer = new AudioMixer();
      this.mixer.setMicGain(this.snap.prefs.micGain);
      this.mixer.setMuted(this.snap.micMuted);
      // Autoplay policy: a context created without a gesture starts suspended.
      const resume = () => void this.mixer?.resume();
      document.addEventListener('pointerdown', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    }
    return this.mixer;
  }

  readLevel(): number {
    return this.mixer?.readLevel() ?? 0;
  }

  setMicMuted(muted: boolean) {
    this.mixer?.setMuted(muted);
    this.set({ micMuted: muted });
  }

  // ---------- PiP ----------
  canPip() {
    return canPip();
  }

  async togglePip() {
    if (this.pipHandle) {
      this.pipHandle.close();
      return;
    }
    try {
      const stream = live(this.snap.camera.stream) ? this.snap.camera.stream! : await this.startCamera();
      this.pipHandle = await openCameraPip(stream, {
        mirror: this.snap.prefs.bubbleMirror,
        onClose: () => {
          this.pipHandle = null;
          this.set({ pip: null });
        },
      });
      this.set({ pip: this.pipHandle.kind });
    } catch (e) {
      if (!(e instanceof TaggedError)) this.notice(`Couldn’t open the floating camera: ${(e as Error)?.message ?? e}`);
    }
  }

  // ---------- recording ----------
  private fail(e: unknown) {
    const info = e instanceof TaggedError ? mediaErrorInfo(e.cause, e.kind) : mediaErrorInfo(e, 'screen');
    this.dispatch({ type: 'FAIL', error: info });
  }

  /** Click on "Start recording". Must run synchronously from the gesture up to getDisplayMedia. */
  async start() {
    const phase = this.snap.rec.phase;
    if (isBusy(phase)) return;
    const prefs = this.snap.prefs;
    const mode = prefs.mode;
    if (!hasMediaRecorder()) {
      this.dispatch({ type: 'FAIL', error: { title: 'Recording isn’t supported', message: 'This browser has no MediaRecorder. Try a current Chrome, Edge, Firefox or Safari.', canRetry: false } });
      return;
    }
    if (needsScreen(mode) && !canRecordScreen()) {
      this.dispatch({ type: 'FAIL', error: { title: 'Screen recording needs a desktop browser', message: 'Pick “Camera only” or “Audio only”, or open this page on a computer.', canRetry: false } });
      return;
    }
    const token = ++this.startToken;
    this.dispatch({ type: 'PREPARE' });
    this.set({ bytes: 0, lastSaved: null, notices: [] });

    let screen: MediaStream | null = null;
    try {
      // 1. Screen picker first, while we still have the user gesture.
      if (needsScreen(mode)) {
        try {
          screen = await getScreen({ audio: prefs.systemAudio, fps: prefs.fps });
        } catch (e) {
          throw new TaggedError('screen', e);
        }
        if (token !== this.startToken) return stopStream(screen);
        this.set({ screen });
        const st = screen.getVideoTracks()[0];
        st?.addEventListener('ended', () => this.onShareEnded(screen!));
      }
      void this.getMixer().resume();

      // 2. Camera and mic (reuse the previews).
      this.previewWanted = true;
      const camera = needsCamera(mode) ? await this.startCamera() : null;
      const wantMic = prefs.micEnabled || mode === 'audio';
      let mic: MediaStream | null = null;
      if (wantMic) {
        try {
          mic = await this.startMic();
        } catch (e) {
          if (mode === 'audio') throw e;
          this.notice('Recording without the microphone (it couldn’t be started).');
        }
      }
      if (token !== this.startToken) return;

      // 3. Audio: mic + tab/system audio mixed into one track.
      const mixer = this.getMixer();
      mixer.clearSystem();
      if (screen && screen.getAudioTracks().length) mixer.addSystem(screen);
      else if (screen && prefs.systemAudio) {
        this.notice('No tab or system audio was shared. To include it, tick “Share tab audio” / “Share system audio” in the browser’s picker (Chrome and Edge).');
      }
      const audioTrack = mixer.sourceCount > 0 || mic ? mixer.track : null;

      // 4. Video.
      let videoTrack: MediaStreamTrack | null = null;
      let size: { width: number; height: number } | null = null;
      let path: CompositorPath | null = null;
      if (screen) {
        const st = screen.getVideoTracks()[0];
        const s = st.getSettings();
        if (mode === 'screen-camera' && camera) {
          size = outputSize(s.width ?? 1920, s.height ?? 1080, prefs.resolution);
          const force = forcedCompositor();
          this.compositor = await createCompositor({
            screen: st,
            camera: camera.getVideoTracks()[0] ?? null,
            width: size.width,
            height: size.height,
            fps: prefs.fps,
            layout: this.layout(),
            force: force === 'worker-breakout' || force === 'worker-spec' || force === 'main-canvas' ? force : undefined,
            onError: (m) => console.warn('[recorder] compositor:', m),
          });
          if (token !== this.startToken) return;
          videoTrack = this.compositor.track;
          path = this.compositor.path;
        } else {
          await capTrack(st, prefs.resolution, prefs.fps);
          videoTrack = st;
          const s2 = st.getSettings();
          size = { width: s2.width ?? s.width ?? 0, height: s2.height ?? s.height ?? 0 };
        }
      } else if (camera) {
        videoTrack = camera.getVideoTracks()[0];
        const s = videoTrack.getSettings();
        size = { width: s.width ?? 0, height: s.height ?? 0 };
      }

      const format = pickFormat({ video: !!videoTrack, audio: !!audioTrack, prefer: prefs.container, isTypeSupported });
      this.recordStream = new MediaStream([videoTrack, audioTrack].filter((t): t is MediaStreamTrack => !!t));
      this.set({ outputStream: videoTrack ? new MediaStream([videoTrack]) : null, outputSize: size, compositorPath: path, format });

      if (this.snap.rec.phase !== 'preparing' || token !== this.startToken) return;
      if (prefs.countdown) {
        this.dispatch({ type: 'COUNTDOWN', seconds: COUNTDOWN_SECONDS });
        this.stopCountdown = every(1000, () => {
          if (this.snap.rec.phase !== 'countdown') return;
          if (this.snap.rec.countdown <= 1) void this.begin();
          else this.dispatch({ type: 'COUNTDOWN_TICK' });
        });
      } else {
        await this.begin();
      }
    } catch (e) {
      if (token !== this.startToken) return;
      this.teardownRecording();
      this.fail(e);
    }
  }

  skipCountdown() {
    if (this.snap.rec.phase === 'countdown') void this.begin();
  }

  cancel() {
    const p = this.snap.rec.phase;
    if (p !== 'preparing' && p !== 'countdown') return;
    this.startToken++;
    this.teardownRecording();
    this.dispatch({ type: 'CANCEL' });
  }

  private async begin() {
    this.stopCountdown?.();
    this.stopCountdown = null;
    const phase = this.snap.rec.phase;
    if ((phase !== 'countdown' && phase !== 'preparing') || !this.recordStream || this.session) return;
    const prefs = this.snap.prefs;
    const size = this.snap.outputSize;
    const hasVideo = this.recordStream.getVideoTracks().length > 0;
    const session = new RecordingSession({
      stream: this.recordStream,
      format: this.snap.format,
      videoBitsPerSecond: hasVideo && size ? videoBitrate(size.width || 1280, size.height || 720, prefs.fps, prefs.quality) : undefined,
      audioBitsPerSecond: audioBitrate(prefs.quality),
      store: this.store,
      mode: prefs.mode,
      width: size?.width || undefined,
      height: size?.height || undefined,
      onError: (e) => this.onSessionError(e),
      onProgress: (bytes) => this.set({ bytes }),
    });
    this.session = session;
    try {
      void requestPersistence();
      await session.start();
    } catch (e) {
      this.session = null;
      await session.discard().catch(() => {}); // drop the empty metadata row
      this.teardownRecording();
      this.dispatch({ type: 'FAIL', error: mediaErrorInfo(e, 'screen') });
      return;
    }
    this.dispatch({ type: 'START', now: performance.now(), recordingId: session.id });
    this.stopTicker = every(500, () => this.onTick());
  }

  private onTick() {
    const s = this.session;
    if (!s) return;
    this.updateTitle();
    const max = this.snap.prefs.maxMinutes;
    if (max > 0 && this.snap.rec.phase === 'recording' && s.elapsed() >= max * 60_000) void this.stop('max-duration');
  }

  private onSessionError(e: unknown) {
    const quota = (e as { name?: string })?.name === 'QuotaExceededError';
    this.notice(quota ? 'Storage is full, so the recording was stopped. Free up space by deleting old recordings.' : `Recording error: ${(e as Error)?.message ?? e}`);
    if (isActive(this.snap.rec.phase)) void this.stop('user');
  }

  private onShareEnded(screen: MediaStream) {
    if (this.snap.screen !== screen) return;
    const p = this.snap.rec.phase;
    if (p === 'preparing' || p === 'countdown') {
      this.notice('Screen sharing ended before the recording started.');
      this.cancel();
    } else if (isActive(p)) {
      void this.stop('share-ended');
    }
  }

  pause() {
    if (this.snap.rec.phase !== 'recording' || !this.session) return;
    this.session.pause();
    this.dispatch({ type: 'PAUSE', now: performance.now() });
  }

  resume() {
    if (this.snap.rec.phase !== 'paused' || !this.session) return;
    this.session.resume();
    this.dispatch({ type: 'RESUME', now: performance.now() });
  }

  togglePause() {
    if (this.snap.rec.phase === 'recording') this.pause();
    else if (this.snap.rec.phase === 'paused') this.resume();
  }

  toggleRecord() {
    const p = this.snap.rec.phase;
    if (isActive(p)) void this.stop('user');
    else if (p === 'countdown') this.skipCountdown();
    else if (p === 'idle' || p === 'done' || p === 'error') void this.start();
  }

  async stop(reason: StopReason = 'user') {
    const p = this.snap.rec.phase;
    if (p === 'preparing' || p === 'countdown') return this.cancel();
    if (!isActive(p) || !this.session) return;
    const session = this.session;
    this.dispatch({ type: 'STOP', now: performance.now(), reason });
    this.stopTicker?.();
    this.stopTicker = null;
    try {
      const meta = await session.finish();
      this.session = null;
      this.teardownRecording();
      this.set({ lastSaved: meta });
      this.dispatch({ type: 'SAVED', recordingId: meta.id });
      void this.makeThumbnail(meta);
    } catch (e) {
      this.session = null;
      this.teardownRecording();
      this.dispatch({ type: 'FAIL', error: { title: 'Saving failed', message: (e as Error)?.message ?? String(e), canRetry: true } });
    }
  }

  private async makeThumbnail(meta: RecordingMeta) {
    if (!meta.mimeType.startsWith('video/')) return;
    try {
      const thumb = await videoThumbnail(await this.store.getBlob(meta.id));
      if (thumb) {
        await this.store.setThumbnail(meta.id, thumb);
        if (this.snap.lastSaved?.id === meta.id) this.set({ lastSaved: { ...meta, hasThumb: true } });
      }
    } catch {
      /* thumbnails are optional */
    }
  }

  async discard() {
    const p = this.snap.rec.phase;
    if (p === 'preparing' || p === 'countdown') return this.cancel();
    if (!isActive(p) || !this.session) return;
    const s = this.session;
    this.session = null;
    this.stopTicker?.();
    this.stopTicker = null;
    this.dispatch({ type: 'DISCARD' });
    await s.discard();
    this.teardownRecording();
  }

  reset() {
    this.dispatch({ type: 'RESET' });
  }

  /** Test mode helper: behave as if the browser's "Stop sharing" button was clicked. */
  simulateStopSharing() {
    simulateStopSharing(this.snap.screen);
  }

  /** Releases everything specific to one recording (screen, compositor, system audio). */
  private teardownRecording() {
    this.stopCountdown?.();
    this.stopCountdown = null;
    this.stopTicker?.();
    this.stopTicker = null;
    this.compositor?.stop();
    this.compositor = null;
    stopStream(this.snap.screen);
    this.mixer?.clearSystem();
    this.recordStream = null;
    this.set({ screen: null, outputStream: null, compositorPath: null, micMuted: false });
    this.mixer?.setMuted(false);
    this.updateTitle();
  }

  // ---------- title ----------
  setBaseTitle(t: string) {
    this.baseTitle = t;
    this.updateTitle();
  }

  private updateTitle() {
    if (typeof document === 'undefined') return;
    const { phase } = this.snap.rec;
    const t = this.session ? formatDuration(this.session.elapsed()) : '';
    if (phase === 'recording') document.title = `● REC ${t} · ${this.baseTitle}`;
    else if (phase === 'paused') document.title = `❚❚ Paused ${t} · ${this.baseTitle}`;
    else if (phase === 'countdown') document.title = `Starting in ${this.snap.rec.countdown}… · ${this.baseTitle}`;
    else if (phase === 'saving') document.title = `Saving… · ${this.baseTitle}`;
    else document.title = this.baseTitle;
  }

  elapsed(): number {
    return this.session?.elapsed() ?? this.snap.rec.accumulatedMs;
  }

  /** Page is going away: stop every track and close audio. Chunks already in IndexedDB stay recoverable. */
  dispose() {
    this.startToken++;
    this.pipHandle?.close();
    this.teardownRecording();
    stopStream(this.snap.camera.stream);
    stopStream(this.snap.mic.stream);
    this.mixer?.close();
    this.mixer = null;
  }
}
