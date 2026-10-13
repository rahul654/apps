/**
 * Test mode (`?fake=1`): generated sources replace the screen, camera and mic, so the whole
 * pipeline can run in automated Chromium without devices or screen-share prompts.
 *
 *  - screen: 1280×720 canvas, a moving shape + running clock + frame counter
 *  - camera: 640×480 canvas, a coloured "face" that blinks
 *  - mic:    OscillatorNode tone (440 Hz, slowly pulsing so the level meter moves)
 *  - tab audio (screen "system audio"): a quieter 660 Hz tone
 *
 * Video sources are real MediaStreams from canvas.captureStream(). Drawing is driven by the
 * worker ticker so it continues in background tabs.
 */
import { every } from './ticker';

export function isFakeMode(): boolean {
  if (typeof location === 'undefined') return false;
  const fromSearch = new URLSearchParams(location.search).get('fake');
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
  const fromHash = new URLSearchParams(hashQuery).get('fake');
  return fromSearch === '1' || fromHash === '1';
}

/** Debug override for the compositor path: `?compositor=main-canvas`. */
export function forcedCompositor(): string | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const hq = new URLSearchParams(location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '');
  return q.get('compositor') ?? hq.get('compositor');
}

let audioCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
    // Autoplay policy: a context created without a gesture starts suspended.
    const resume = () => void audioCtx?.resume().catch(() => {});
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }
  void audioCtx.resume().catch(() => {});
  return audioCtx;
}

function canvasStream(w: number, h: number, fps: number, draw: (c: CanvasRenderingContext2D, frame: number, t: number) => void): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  let frame = 0;
  const t0 = performance.now();
  draw(c, frame, 0);
  const stream = canvas.captureStream(fps);
  const stop = every(1000 / fps, () => {
    if (stream.getVideoTracks().every((t) => t.readyState === 'ended')) {
      stop();
      return;
    }
    frame++;
    draw(c, frame, (performance.now() - t0) / 1000);
  });
  return stream;
}

function tone(freq: number, volume: number, pulse: boolean): MediaStream {
  const ac = ctx();
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const gain = ac.createGain();
  gain.gain.value = volume;
  if (pulse) {
    // 0.5 Hz amplitude wobble so the meter visibly moves.
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.5;
    const depth = ac.createGain();
    depth.gain.value = volume * 0.8;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
  }
  const dest = ac.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  const track = dest.stream.getAudioTracks()[0];
  const origStop = track.stop.bind(track);
  track.stop = () => {
    try {
      osc.stop();
    } catch {
      /* already stopped */
    }
    osc.disconnect();
    origStop();
  };
  return dest.stream;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fakeScreen(withAudio: boolean, fps = 30): MediaStream {
  const W = 1280;
  const H = 720;
  const stream = canvasStream(W, H, fps, (c, frame, t) => {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1e1b4b');
    g.addColorStop(1, '#0f766e');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // Grid, so scaling / letterboxing is visible.
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += 80) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    for (let y = 0; y <= H; y += 80) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    // Moving shape.
    const x = W / 2 + Math.cos(t * 1.3) * (W / 2 - 120);
    const y = H / 2 + Math.sin(t * 2.1) * (H / 2 - 120);
    c.save();
    c.translate(x, y);
    c.rotate(t * 2);
    c.fillStyle = '#f59e0b';
    c.fillRect(-60, -60, 120, 120);
    c.restore();
    // Clock + frame counter.
    const now = new Date();
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(24, 24, 470, 132);
    c.fillStyle = '#fff';
    c.font = 'bold 56px ui-monospace, Menlo, Consolas, monospace';
    c.fillText(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`, 44, 92);
    c.font = '28px ui-monospace, Menlo, Consolas, monospace';
    c.fillText(`frame ${frame}  ·  t=${t.toFixed(2)}s`, 44, 136);
    c.font = 'bold 22px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillText('FAKE SCREEN (test mode)', W - 330, H - 30);
  });
  if (withAudio) {
    for (const t of tone(660, 0.06, false).getAudioTracks()) stream.addTrack(t);
  }
  for (const t of stream.getVideoTracks()) {
    Object.defineProperty(t, 'label', { value: 'Fake screen (test mode)' });
  }
  return stream;
}

export function fakeCamera(fps = 30): MediaStream {
  const W = 640;
  const H = 480;
  return canvasStream(W, H, fps, (c, frame, t) => {
    c.fillStyle = '#334155';
    c.fillRect(0, 0, W, H);
    const hue = (t * 40) % 360;
    // Face.
    c.fillStyle = `hsl(${hue}, 70%, 60%)`;
    c.beginPath();
    c.arc(W / 2, H / 2, 170, 0, Math.PI * 2);
    c.fill();
    // Eyes (blink every ~3 s). The left eye is bigger, so mirroring is visible.
    const blink = frame % 90 < 5;
    c.fillStyle = '#111827';
    for (const [ex, r] of [
      [W / 2 - 60, 26],
      [W / 2 + 60, 18],
    ] as const) {
      c.beginPath();
      c.ellipse(ex, H / 2 - 40, r, blink ? 3 : r, 0, 0, Math.PI * 2);
      c.fill();
    }
    // Mouth.
    c.strokeStyle = '#111827';
    c.lineWidth = 10;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(W / 2, H / 2 + 30, 70, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.fillStyle = '#fff';
    c.font = 'bold 26px system-ui, sans-serif';
    c.fillText('L', 30, 50);
    c.fillText(`cam ${frame}`, W - 150, H - 24);
  });
}

export function fakeMic(): MediaStream {
  return tone(440, 0.25, true);
}

export const FAKE_CAMERA_ID = 'fake-camera';
export const FAKE_MIC_ID = 'fake-mic';

export function fakeDevices(): { cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[] } {
  const dev = (deviceId: string, kind: MediaDeviceKind, label: string) => ({ deviceId, kind, label, groupId: 'fake', toJSON: () => ({}) }) as MediaDeviceInfo;
  return {
    cameras: [dev(FAKE_CAMERA_ID, 'videoinput', 'Fake camera (test mode)')],
    mics: [dev(FAKE_MIC_ID, 'audioinput', 'Fake microphone: 440 Hz tone (test mode)')],
  };
}

/** Ends a fake screen the way the browser's "Stop sharing" button would. */
export function simulateStopSharing(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getVideoTracks()) {
    t.stop();
    t.dispatchEvent(new Event('ended'));
  }
}
