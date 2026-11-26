import { memo } from 'react';
import { graphScale } from '../lib/playback';
import { useTime } from '../store/player';
import type { Song } from '../types';

const W = 1000;
const H = 100;

function curvePath(heatmap: readonly number[]): { area: string; line: string } | null {
  const n = heatmap.length;
  if (n === 0) return null;
  const max = graphScale(heatmap);
  const pts = heatmap.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - Math.min(1, v / max) * (H - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join('L')}`;
  return { line, area: `M0,${H}L${pts.join('L')}L${W},${H}Z` };
}

function Playhead({ duration }: { duration: number }) {
  const t = useTime();
  const x = Math.min(W, Math.max(0, (t / duration) * W));
  return <line className="graph-playhead" x1={x} x2={x} y1={0} y2={H} vectorEffect="non-scaling-stroke" />;
}

/**
 * YouTube's "Most replayed" curve with the song's segments shaded. The y axis is scaled to the
 * highest point after the intro spike, which is clipped at the top.
 */
export const ReplayGraph = memo(function ReplayGraph({ song, showPlayhead }: { song: Song; showPlayhead: boolean }) {
  const curve = curvePath(song.heatmap);
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Replay graph for ${song.name}`}>
      {song.segments.map((s) => (
        <rect
          key={s.rank}
          className={s.rank === 1 ? 'graph-seg top' : 'graph-seg'}
          x={(s.start / song.duration) * W}
          y={0}
          width={((s.end - s.start) / song.duration) * W}
          height={H}
        />
      ))}
      {curve && (
        <>
          <path className="graph-area" d={curve.area} />
          <path className="graph-line" d={curve.line} vectorEffect="non-scaling-stroke" />
        </>
      )}
      {showPlayhead && <Playhead duration={song.duration} />}
    </svg>
  );
});
