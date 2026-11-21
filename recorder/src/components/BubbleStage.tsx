import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { bubbleFraction, clampPosition, dragPosition, type BubbleLayout } from '../lib/geometry';
import { IconScreen } from './Icons';
import { VideoPreview } from './VideoPreview';

/**
 * Preview of the output frame with the camera bubble. Before recording it shows a placeholder
 * screen with the live camera inside the bubble; while recording it shows the composited output
 * (bubble already burned in) with a transparent drag handle on top.
 * Bubble position is stored as fractions of the frame, so the preview's CSS size doesn't matter.
 */
export function BubbleStage({
  frame,
  layout,
  background,
  camera,
  showCamera,
  onMove,
  disabled,
}: {
  frame: { width: number; height: number };
  layout: BubbleLayout;
  background: MediaStream | null;
  camera: MediaStream | null;
  /** Draw the camera inside the bubble (false when the background already contains it). */
  showCamera: boolean;
  onMove: (x: number, y: number) => void;
  disabled?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; id: number } | null>(null);
  const { fw, fh } = bubbleFraction(layout.shape, layout.size, frame.width, frame.height);
  const pos = clampPosition(layout.x, layout.y, fw, fh);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, x: pos.x, y: pos.y, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!d || d.id !== e.pointerId || !rect) return;
    const p = dragPosition({ x: d.x, y: d.y }, e.clientX - d.startX, e.clientY - d.startY, rect.width, rect.height, fw, fh);
    onMove(p.x, p.y);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const p = clampPosition(pos.x + d[0], pos.y + d[1], fw, fh);
    onMove(p.x, p.y);
  };

  // Rounded rects are 4:3, so a 14%-of-height corner is 10.5% of the width (matches the canvas drawing).
  const radius = layout.shape === 'circle' ? '50%' : '10.5% / 14%';
  return (
    <div ref={stage} className="stage" style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
      {background ? (
        <VideoPreview stream={background} className="stage-video" label="Live preview of the recording" />
      ) : (
        <div className="stage-placeholder" aria-hidden="true">
          <IconScreen size={44} />
          <span>Your screen, tab or window goes here</span>
        </div>
      )}
      <div
        className={`bubble ${showCamera ? '' : 'handle'} ${layout.border && showCamera ? 'bordered' : ''} ${disabled ? 'locked' : ''}`}
        style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, width: `${fw * 100}%`, height: `${fh * 100}%`, borderRadius: radius }}
        role="group"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Camera bubble at ${Math.round(pos.x * 100)}% from the left, ${Math.round(pos.y * 100)}% from the top. Drag, or use the arrow keys to move it (Shift for bigger steps).`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {showCamera &&
          (camera ? (
            <VideoPreview stream={camera} mirror={layout.mirror} className="bubble-video" style={{ borderRadius: radius }} label="Camera preview" />
          ) : (
            <span className="bubble-empty">Camera off</span>
          ))}
      </div>
    </div>
  );
}
