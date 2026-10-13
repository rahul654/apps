/**
 * Floating camera window, so the user can see themselves while recording another app.
 * Document Picture-in-Picture (Chromium 116+) gets a styled window with a label; otherwise
 * classic video Picture-in-Picture. Preview only: the bubble is composited into the
 * recording independently.
 */
import { hasDocumentPip, hasVideoPip } from './features';

export const PIP_NOTE = 'Preview only — the bubble is added to the recording automatically';

export interface PipHandle {
  kind: 'document' | 'video';
  close(): void;
}

export function canPip(): boolean {
  return hasDocumentPip() || hasVideoPip();
}

/** Must be called from a user gesture. `onClose` fires however the window gets closed. */
export async function openCameraPip(stream: MediaStream, opts: { mirror: boolean; onClose: () => void }): Promise<PipHandle> {
  const dpip = window.documentPictureInPicture;
  if (dpip) {
    const win = await dpip.requestWindow({ width: 300, height: 260 });
    const doc = win.document;
    doc.title = 'Camera preview';
    const style = doc.createElement('style');
    style.textContent = `
      html,body{margin:0;height:100%;background:#0b0b10;color:#e5e7eb;font:12px system-ui,-apple-system,'Segoe UI',sans-serif}
      body{display:flex;flex-direction:column}
      video{flex:1;min-height:0;width:100%;object-fit:cover;${opts.mirror ? 'transform:scaleX(-1);' : ''}}
      p{margin:0;padding:6px 8px;text-align:center;background:#1c1530;color:#ddd6fe}`;
    doc.head.append(style);
    const video = doc.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    const note = doc.createElement('p');
    note.textContent = PIP_NOTE;
    doc.body.append(video, note);
    void video.play().catch(() => {});
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      video.srcObject = null;
      opts.onClose();
    };
    win.addEventListener('pagehide', finish, { once: true });
    return {
      kind: 'document',
      close: () => {
        finish();
        win.close();
      },
    };
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0';
  document.body.appendChild(video);
  await video.play().catch(() => {});
  if (video.readyState < 1) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  const cleanup = () => {
    video.srcObject = null;
    video.remove();
    opts.onClose();
  };
  video.addEventListener('leavepictureinpicture', cleanup, { once: true });
  try {
    await video.requestPictureInPicture();
  } catch (e) {
    video.removeEventListener('leavepictureinpicture', cleanup);
    video.srcObject = null;
    video.remove();
    throw e;
  }
  return {
    kind: 'video',
    close: () => {
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
      else cleanup();
    },
  };
}
