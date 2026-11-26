import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SongList } from '../components/SongList';
import { findCategory, type Views } from '../lib/views';
import { setView } from '../store/player';
import type { Catalog } from '../types';

const NO_ITEMS: never[] = [];

export function CategoryPage({ catalog, views }: { catalog: Catalog; views: Views }) {
  const { categoryId } = useParams();
  const category = findCategory(catalog, categoryId);
  const items = (category && views.byCategory.get(category.id)) || NO_ITEMS;
  useEffect(() => setView(items), [items]);
  if (!category) {
    return (
      <div className="notfound">
        <h1>Category not found</h1>
        <p className="muted">There’s no category called “{categoryId}”. It may have been renamed.</p>
        <Link className="btn primary" to="/">
          Show all songs
        </Link>
      </div>
    );
  }
  return (
    <section className="section" aria-labelledby="cat-title">
      <div className="section-head">
        <h1 id="cat-title">{category.title}</h1>
        <span className="count">{category.songs.length} {category.songs.length === 1 ? 'song' : 'songs'}</span>
      </div>
      <SongList items={items} />
    </section>
  );
}
