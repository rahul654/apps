import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SongList } from '../components/SongList';
import type { Views } from '../lib/views';
import { setView } from '../store/player';
import type { Catalog } from '../types';

export function HomePage({ catalog, views }: { catalog: Catalog; views: Views }) {
  useEffect(() => setView(views.all), [views]);
  if (catalog.categories.length === 0) return <p className="empty muted">No songs yet.</p>;
  return (
    <div className="sections">
      {catalog.categories.map((c) => {
        const from = views.offsets.get(c.id) ?? 0;
        return (
          <section key={c.id} className="section" aria-labelledby={`cat-${c.id}`}>
            <div className="section-head">
              <h2 id={`cat-${c.id}`}>
                <Link to={`/c/${c.id}`}>{c.title}</Link>
              </h2>
              <span className="count">{c.songs.length} {c.songs.length === 1 ? 'song' : 'songs'}</span>
            </div>
            <SongList items={views.all} from={from} to={from + c.songs.length} />
          </section>
        );
      })}
    </div>
  );
}
