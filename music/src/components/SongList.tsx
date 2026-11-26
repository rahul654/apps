import { currentItem, errorText, usePlayer, type QueueItem } from '../store/player';
import { SongCard } from './SongCard';

/** Cards for `items[from..to)`; `items` is the whole page's list, which becomes the queue on play. */
export function SongList({ items, from = 0, to = items.length }: { items: readonly QueueItem[]; from?: number; to?: number }) {
  const s = usePlayer();
  const current = currentItem(s);
  const playing = s.status === 'playing' || s.status === 'loading';
  if (to <= from) return <p className="empty muted">No songs in this category yet.</p>;
  const cards = [];
  for (let i = from; i < to; i++) {
    const item = items[i];
    const isCurrent = !!current && current.categoryId === item.categoryId && current.song.videoId === item.song.videoId;
    cards.push(
      <SongCard
        key={`${item.categoryId}:${item.song.videoId}:${i}`}
        items={items}
        index={i}
        isCurrent={isCurrent}
        isPlaying={isCurrent && playing}
        isFull={s.fullSet.has(item.song.videoId)}
        activeClip={isCurrent ? s.clip : null}
        unavailable={errorText(item.song.videoId, s)}
      />,
    );
  }
  return <ul className="songs">{cards}</ul>;
}
