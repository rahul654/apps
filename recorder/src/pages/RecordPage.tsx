import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BubbleStage } from '../components/BubbleStage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Feedback';
import {
  IconCamera,
  IconMic,
  IconMicOff,
  IconPause,
  IconPip,
  IconPlay,
  IconRecord,
  IconScreen,
  IconScreenCam,
  IconScreenshot,
  IconStop,
  IconTrash,
  IconWave,
} from '../components/Icons';
import { LevelMeter } from '../components/LevelMeter';
import { RecoveryBanner } from '../components/RecoveryBanner';
import { StorageMeter } from '../components/StorageMeter';
import { VideoPreview } from '../components/VideoPreview';
import { formatBytes, formatDuration, spokenDuration } from '../lib/format';
import { bubbleFraction, nearestCorner, type Corner } from '../lib/geometry';
import { availableContainers, describeMime, pickFormat } from '../lib/mime';
import type { Prefs } from '../lib/prefs';
import { isActive, isBusy, phaseAnnouncement } from '../lib/recorderMachine';
import type { RecordMode } from '../lib/recordingStore';
import { SHORTCUTS, shortcutLabel } from '../lib/shortcuts';
import { PATH_LABEL } from '../media/compositor';
import { needsCamera, needsScreen } from '../media/controller';
import { isFakeMode } from '../media/fake';
import { canRecordScreen, canUseDevices, hasMediaRecorder, isFirefox, isMac, isSafari, isTypeSupported } from '../media/features';
import { PIP_NOTE } from '../media/pip';
import { useController, useRecorder, useTakeScreenshot } from '../store/RecorderContext';
import { cancelScreenshot, captureNow, dismissLastShot, useShot } from '../store/screenshot';

const MODES: Array<{ id: RecordMode; label: string; icon: ReactNode; screen: boolean }> = [
  { id: 'screen-camera', label: 'Screen + camera', icon: <IconScreenCam />, screen: true },
  { id: 'screen', label: 'Screen only', icon: <IconScreen />, screen: true },
  { id: 'camera', label: 'Camera only', icon: <IconCamera />, screen: false },
  { id: 'audio', label: 'Audio only', icon: <IconWave />, screen: false },
];

const CORNERS: Array<{ id: Corner; label: string }> = [
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
];

function useElapsed(active: boolean): number {
  const c = useController();
  const [ms, setMs] = useState(() => c.elapsed());
  useEffect(() => {
    setMs(c.elapsed());
    if (!active) return;
    const t = setInterval(() => setMs(c.elapsed()), 250);
    return () => clearInterval(t);
  }, [active, c]);
  return ms;
}

function Segmented<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function deviceLabel(d: MediaDeviceInfo, i: number, kind: string) {
  return d.label || `${kind} ${i + 1}`;
}

export function RecordPage() {
  const c = useController();
  const s = useRecorder();
  const { prefs, rec } = s;
  const phase = rec.phase;
  const busy = isBusy(phase);
  const active = isActive(phase);
  const elapsed = useElapsed(active || phase === 'saving');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const mac = isMac();
  const screenOk = canRecordScreen();
  const devicesOk = canUseDevices();
  const set = (patch: Partial<Prefs>) => c.updatePrefs(patch);

  // Phones / browsers without getDisplayMedia: fall back to a mode that works.
  useEffect(() => {
    if (!screenOk && needsScreen(prefs.mode)) c.updatePrefs({ mode: 'camera' });
  }, [screenOk, prefs.mode, c]);

  useEffect(() => {
    void c.autoPreview();
  }, [c]);

  const hasAudio = prefs.mode === 'audio' || prefs.micEnabled || (needsScreen(prefs.mode) && prefs.systemAudio);
  const predicted = useMemo(
    () => pickFormat({ video: prefs.mode !== 'audio', audio: hasAudio, prefer: prefs.container, isTypeSupported }),
    [prefs.mode, prefs.container, hasAudio],
  );
  const containers = useMemo(() => availableContainers(true, isTypeSupported), []);
  const format = busy && s.format ? s.format : predicted;

  const frame = s.outputSize && s.outputSize.width > 0 ? s.outputSize : { width: 1920, height: 1080 };
  const layout = c.layout();
  const { fw, fh } = bubbleFraction(layout.shape, layout.size, frame.width, frame.height);
  const corner = nearestCorner(layout.x, layout.y, fw, fh);
  const camOn = !!s.camera.stream;
  const micOn = !!s.mic.stream;
  const deviceLocked = busy;

  const shot = useShot();
  const takeShot = useTakeScreenshot();
  const recordingScreen = active && !!s.screen;
  const announcement = shot.phase === 'countdown' ? `Screenshot in ${shot.secondsLeft}` : phaseAnnouncement(rec);

  return (
    <div className="stack">
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {announcement}
      </div>
      <RecoveryBanner />

      {!hasMediaRecorder() && (
        <Notice kind="error">This browser can’t record media (no MediaRecorder). Try a current Chrome, Edge, Firefox or Safari.</Notice>
      )}
      {!screenOk && (
        <Notice kind="info">
          <strong>Screen recording needs a desktop browser.</strong> This browser can’t capture the screen, but camera and audio recording work.
        </Notice>
      )}
      {s.notices.map((n) => (
        <Notice key={n} kind="warn" onDismiss={() => c.dismissNotice(n)}>
          {n}
        </Notice>
      ))}

      <div className="record-layout">
        <section className="stack" aria-label="Recorder">
          <div className="mode-tabs" role="radiogroup" aria-label="What to record">
            {MODES.filter((m) => screenOk || !m.screen).map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={prefs.mode === m.id}
                className={prefs.mode === m.id ? 'mode active' : 'mode'}
                disabled={busy}
                onClick={() => set({ mode: m.id })}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          <div className={`stage-wrap ${active ? 'is-recording' : ''}`}>
            {prefs.mode === 'screen-camera' && (
              <BubbleStage
                frame={frame}
                layout={layout}
                background={s.outputStream}
                camera={s.camera.stream}
                showCamera={!s.outputStream}
                onMove={(x, y) => set({ bubbleX: x, bubbleY: y })}
              />
            )}
            {prefs.mode === 'screen' && (
              <div className="stage" style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
                {s.outputStream ? (
                  <VideoPreview stream={s.outputStream} className="stage-video" label="Live preview of the shared screen" />
                ) : (
                  <div className="stage-placeholder" aria-hidden="true">
                    <IconScreen size={44} />
                    <span>You’ll pick a tab, window or screen when you start</span>
                  </div>
                )}
              </div>
            )}
            {prefs.mode === 'camera' && (
              <div className="stage" style={{ aspectRatio: '16 / 9' }}>
                {s.camera.stream ? (
                  <VideoPreview stream={s.camera.stream} mirror={prefs.bubbleMirror} className="stage-video contain" label="Camera preview (mirrored like a mirror; the recording isn’t)" />
                ) : (
                  <div className="stage-placeholder" aria-hidden="true">
                    <IconCamera size={44} />
                    <span>{s.camera.starting ? 'Starting camera…' : 'Camera is off'}</span>
                  </div>
                )}
              </div>
            )}
            {prefs.mode === 'audio' && (
              <div className="stage audio-stage" style={{ aspectRatio: '16 / 6' }}>
                <IconMic size={40} />
                <div className="audio-meter">
                  <LevelMeter active={micOn} muted={s.micMuted} />
                </div>
                <span className="muted small">{micOn ? 'Speak to test your microphone' : 'Microphone is off'}</span>
              </div>
            )}

            {phase === 'countdown' && (
              <button type="button" className="countdown" onClick={() => c.skipCountdown()} aria-label={`Recording starts in ${rec.countdown}. Click to start now.`}>
                <span className="countdown-num" aria-hidden="true">
                  {rec.countdown}
                </span>
                <span className="countdown-hint">Click or press Space to start now · Esc to cancel</span>
              </button>
            )}
            {shot.phase === 'countdown' && (
              <button type="button" className="countdown shot-countdown" onClick={() => captureNow()} aria-label={`Screenshot in ${shot.secondsLeft}. Click to take it now.`}>
                <span className="countdown-num" aria-hidden="true">
                  {shot.secondsLeft}
                </span>
                <span className="countdown-hint">Screenshot in {shot.secondsLeft} s · Click or press Space to take it now · Esc to cancel</span>
              </button>
            )}
            {shot.phase === 'picking' && <div className="stage-overlay">Pick what to capture…</div>}
            {phase === 'preparing' && <div className="stage-overlay">Waiting for permission…</div>}
            {phase === 'saving' && <div className="stage-overlay">Saving…</div>}
            {phase === 'paused' && <div className="stage-overlay paused-overlay">Paused</div>}
          </div>

          <div className="controls" role="toolbar" aria-label="Recording controls">
            {!busy && (
              <button type="button" className="btn record-btn" onClick={() => void c.start()} disabled={!hasMediaRecorder()} aria-keyshortcuts="Alt+Shift+R">
                <IconRecord /> Start recording
              </button>
            )}
            {(phase === 'preparing' || phase === 'countdown') && (
              <button type="button" className="btn" onClick={() => c.cancel()}>
                Cancel
              </button>
            )}
            {(!busy || recordingScreen) && screenOk && (
              <div className="row nowrap shot-controls">
                {shot.phase === 'countdown' ? (
                  <button type="button" className="btn" onClick={() => cancelScreenshot()}>
                    Cancel screenshot
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={takeShot}
                    disabled={shot.phase !== 'idle'}
                    aria-keyshortcuts="Alt+Shift+S"
                    title={recordingScreen ? 'Grab a frame of the screen you are recording' : 'Pick a screen, window or tab, then highlight and mark it up'}
                  >
                    <IconScreenshot /> {shot.phase === 'idle' ? 'Screenshot' : 'Taking screenshot…'}
                  </button>
                )}
                <label className="sr-only" htmlFor="shot-delay">
                  Screenshot delay
                </label>
                <select
                  id="shot-delay"
                  className="input delay-select"
                  value={prefs.shotDelay}
                  disabled={shot.phase !== 'idle'}
                  onChange={(e) => set({ shotDelay: Number(e.target.value) as Prefs['shotDelay'] })}
                  title="Delay before the screenshot, so you can open a menu or switch windows"
                >
                  <option value={0}>No delay</option>
                  <option value={3}>3 s delay</option>
                  <option value={5}>5 s delay</option>
                  <option value={10}>10 s delay</option>
                </select>
              </div>
            )}
            {active && (
              <>
                <button type="button" className="btn stop-btn" onClick={() => void c.stop('user')} aria-keyshortcuts="Alt+Shift+R">
                  <IconStop /> Stop
                </button>
                <button type="button" className="btn" onClick={() => c.togglePause()} aria-keyshortcuts="Alt+Shift+P">
                  {phase === 'paused' ? (
                    <>
                      <IconPlay /> Resume
                    </>
                  ) : (
                    <>
                      <IconPause /> Pause
                    </>
                  )}
                </button>
                {(micOn || s.mic.starting) && (
                  <button type="button" className="btn" aria-pressed={s.micMuted} onClick={() => c.setMicMuted(!s.micMuted)}>
                    {s.micMuted ? <IconMicOff /> : <IconMic />} {s.micMuted ? 'Unmute mic' : 'Mute mic'}
                  </button>
                )}
                <button type="button" className="btn danger" onClick={() => setConfirmDiscard(true)}>
                  <IconTrash /> Discard
                </button>
              </>
            )}
            <span className="spacer" />
            {(active || phase === 'saving') && (
              <div className="rec-status">
                <span className={phase === 'recording' ? 'rec-badge live' : 'rec-badge'}>{phase === 'paused' ? 'PAUSED' : phase === 'saving' ? 'SAVING' : 'REC'}</span>
                <span className="timer mono" role="timer" aria-label={`Recorded ${spokenDuration(elapsed)}`}>
                  {formatDuration(elapsed)}
                  {prefs.maxMinutes > 0 && <span className="muted"> / {formatDuration(prefs.maxMinutes * 60_000)}</span>}
                </span>
                <span className="muted small">{formatBytes(s.bytes)}</span>
              </div>
            )}
          </div>

          <p className="muted small shortcut-hints">
            {SHORTCUTS.map((k) => (
              <span key={k.action}>
                <kbd>{shortcutLabel(k.keys, mac)}</kbd> {k.label}
              </span>
            ))}
            <span>Shortcuts work while this tab is focused.</span>
          </p>

          {phase === 'done' && s.lastSaved && (
            <Notice
              kind="success"
              onDismiss={() => c.reset()}
              actions={
                <>
                  <Link className="btn small primary" to={`/play/${s.lastSaved.id}`}>
                    Open
                  </Link>
                  <Link className="btn small" to="/library">
                    Library
                  </Link>
                </>
              }
            >
              <strong>Saved “{s.lastSaved.title}”</strong> · {formatDuration(s.lastSaved.durationMs)} · {formatBytes(s.lastSaved.size)} ·{' '}
              {describeMime(s.lastSaved.mimeType).label}
              {rec.stopReason === 'share-ended' && <> · stopped because screen sharing ended</>}
              {rec.stopReason === 'max-duration' && <> · stopped at the maximum length</>}
              {rec.stopReason === 'device-lost' && <> · stopped because the camera disconnected</>}
            </Notice>
          )}
          {shot.last && active && (
            <Notice kind="success" onDismiss={() => dismissLastShot()} actions={<Link className="btn small" to={`/shot/${shot.last.id}`}>Open</Link>}>
              <strong>Screenshot saved</strong> · “{shot.last.title}” is in the library. Recording continues.
            </Notice>
          )}
          {phase === 'error' && rec.error && (
            <Notice
              kind="error"
              onDismiss={() => c.reset()}
              actions={
                rec.error.canRetry ? (
                  <button type="button" className="btn small primary" onClick={() => void c.start()}>
                    Try again
                  </button>
                ) : undefined
              }
            >
              <strong>{rec.error.title}.</strong> {rec.error.message}
            </Notice>
          )}
          {s.compositorPath && (
            <p className="muted tiny">Compositing: {PATH_LABEL[s.compositorPath]}</p>
          )}
          <StorageMeter refreshKey={s.lastSaved?.id} />
        </section>

        <aside className="stack settings" aria-label="Settings">
          <div className="card stack">
            <h2>Devices</h2>
            {!devicesOk && <Notice kind="warn">This browser can’t access cameras or microphones.</Notice>}
            {needsCamera(prefs.mode) && (
              <div className="stack-sm">
                <label className="field">
                  <span>Camera</span>
                  <select className="input" value={prefs.cameraId} disabled={deviceLocked || !devicesOk} onChange={(e) => set({ cameraId: e.target.value })}>
                    <option value="">Default camera</option>
                    {s.devices.cameras
                      .filter((d) => d.deviceId)
                      .map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {deviceLabel(d, i, 'Camera')}
                        </option>
                      ))}
                  </select>
                </label>
                {s.camera.error && (
                  <Notice kind="error" actions={<button type="button" className="btn small" onClick={() => void c.startCamera(true).catch(() => {})}>Retry</button>}>
                    <strong>{s.camera.error.title}.</strong> {s.camera.error.message}
                  </Notice>
                )}
              </div>
            )}
            <div className="stack-sm">
              <div className="row">
                <label className="check grow">
                  <input type="checkbox" checked={prefs.micEnabled || prefs.mode === 'audio'} disabled={prefs.mode === 'audio' || deviceLocked} onChange={(e) => set({ micEnabled: e.target.checked })} />
                  Record microphone
                </label>
              </div>
              {(prefs.micEnabled || prefs.mode === 'audio') && (
                <>
                  <label className="field">
                    <span>Microphone</span>
                    <select className="input" value={prefs.micId} disabled={deviceLocked || !devicesOk} onChange={(e) => set({ micId: e.target.value })}>
                      <option value="">Default microphone</option>
                      {s.devices.mics
                        .filter((d) => d.deviceId && d.deviceId !== 'default')
                        .map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {deviceLabel(d, i, 'Microphone')}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="row nowrap">
                    <IconMic size={16} />
                    <LevelMeter active={micOn} muted={s.micMuted} />
                  </div>
                  <label className="field">
                    <span>
                      Mic volume: {Math.round(prefs.micGain * 100)}%{s.micMuted ? ' (muted)' : ''}
                    </span>
                    <input type="range" min={0} max={2} step={0.05} value={prefs.micGain} onChange={(e) => set({ micGain: Number(e.target.value) })} />
                  </label>
                  {s.mic.error && (
                    <Notice kind="error" actions={<button type="button" className="btn small" onClick={() => void c.startMic(true).catch(() => {})}>Retry</button>}>
                      <strong>{s.mic.error.title}.</strong> {s.mic.error.message}
                    </Notice>
                  )}
                </>
              )}
            </div>
            {needsScreen(prefs.mode) && (
              <label className="check">
                <input type="checkbox" checked={prefs.systemAudio} disabled={deviceLocked || isSafari() || isFirefox()} onChange={(e) => set({ systemAudio: e.target.checked })} />
                <span>
                  Include tab / system audio
                  <span className="muted tiny block">
                    {isSafari() || isFirefox() ? 'Not supported in this browser.' : 'Tick “Share audio” in the picker. Tab audio everywhere; whole-screen audio on Windows and ChromeOS.'}
                  </span>
                </span>
              </label>
            )}
            {!busy && (
              <div className="row">
                {camOn || micOn ? (
                  <button type="button" className="btn small" onClick={() => c.stopPreview()}>
                    Turn off camera & mic
                  </button>
                ) : (
                  (needsCamera(prefs.mode) || prefs.micEnabled || prefs.mode === 'audio') && (
                    <button type="button" className="btn small primary" onClick={() => void c.startPreview().catch(() => {})} disabled={!devicesOk || s.camera.starting || s.mic.starting}>
                      {s.camera.starting || s.mic.starting ? 'Starting…' : needsCamera(prefs.mode) ? 'Turn on camera & mic preview' : 'Turn on mic preview'}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {prefs.mode === 'screen-camera' && (
            <div className="card stack">
              <h2>Camera bubble</h2>
              <Segmented label="Shape" value={prefs.bubbleShape} options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }]} onChange={(v) => set({ bubbleShape: v })} />
              <Segmented label="Size" value={prefs.bubbleSize} options={[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }]} onChange={(v) => set({ bubbleSize: v })} />
              <div className="field">
                <span className="field-label" id="corner-label">
                  Position <span className="muted tiny">(or drag the bubble in the preview)</span>
                </span>
                <div className="corner-grid" role="group" aria-labelledby="corner-label">
                  {CORNERS.map((k) => (
                    <button key={k.id} type="button" className={`corner corner-${k.id}`} aria-pressed={corner === k.id} aria-label={k.label} title={k.label} onClick={() => c.setBubbleCorner(k.id)}>
                      <span aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
              <label className="check">
                <input type="checkbox" checked={prefs.bubbleMirror} onChange={(e) => set({ bubbleMirror: e.target.checked })} /> Mirror camera
              </label>
              <label className="check">
                <input type="checkbox" checked={prefs.bubbleBorder} onChange={(e) => set({ bubbleBorder: e.target.checked })} /> White border
              </label>
              {c.canPip() && (
                <div className="stack-sm">
                  <button type="button" className="btn small" aria-pressed={s.pip !== null} onClick={() => void c.togglePip()}>
                    <IconPip size={16} /> {s.pip ? 'Close floating camera' : 'Floating camera window'}
                  </button>
                  <span className="muted tiny">{PIP_NOTE}.</span>
                </div>
              )}
            </div>
          )}

          <div className="card stack">
            <h2>Output</h2>
            {prefs.mode !== 'audio' && (
              <>
                <Segmented
                  label="Resolution"
                  value={prefs.resolution}
                  disabled={busy}
                  options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: 'source', label: 'Source' }]}
                  onChange={(v) => set({ resolution: v })}
                />
                <Segmented label="Frame rate" value={prefs.fps} disabled={busy} options={[{ value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }]} onChange={(v) => set({ fps: v })} />
              </>
            )}
            <Segmented label="Quality" value={prefs.quality} disabled={busy} options={[{ value: 'low', label: 'Small file' }, { value: 'medium', label: 'Balanced' }, { value: 'high', label: 'High' }]} onChange={(v) => set({ quality: v })} />
            {containers.length > 1 && prefs.mode !== 'audio' && (
              <Segmented
                label="Format"
                value={prefs.container}
                disabled={busy}
                options={[{ value: 'auto', label: 'Auto' }, ...containers.map((k) => ({ value: k, label: k === 'mp4' ? 'MP4' : 'WebM' }))]}
                onChange={(v) => set({ container: v })}
              />
            )}
            <p className="small">
              Records as <strong>{format ? format.label : 'browser default'}</strong>
            </p>
            <label className="check">
              <input type="checkbox" checked={prefs.countdown} onChange={(e) => set({ countdown: e.target.checked })} /> 3-2-1 countdown
            </label>
            <label className="field">
              <span>Maximum length</span>
              <select className="input" value={prefs.maxMinutes} onChange={(e) => set({ maxMinutes: Number(e.target.value) })}>
                <option value={0}>No limit</option>
                {[1, 5, 10, 15, 30, 60, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          {isFakeMode() && <p className="muted tiny">Test mode: sources are generated, no prompts are shown.</p>}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this recording?"
        confirmLabel="Discard"
        danger
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          void c.discard();
        }}
      >
        Everything recorded so far will be deleted. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}
