import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/format';
import type { BoardMeta, Thumbnail } from '../lib/types';
import { IconMore } from './Icons';
import { Menu } from './Menu';

export interface CardActions {
  rename: (id: string, title: string) => void;
  duplicate: (id: string) => void;
  download: (id: string) => void;
  remove: (id: string) => void;
}

export function BoardCard({ board, thumb, now, actions }: { board: BoardMeta; thumb?: Thumbnail; now: number; actions: CardActions }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(board.title);
  const input = useRef<HTMLInputElement>(null);
  const titleLink = useRef<HTMLAnchorElement>(null);
  const href = `/b/${board.id}`;

  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);

  const finish = (commit: boolean) => {
    if (commit && draft.trim() && draft !== board.title) actions.rename(board.id, draft);
    setRenaming(false);
    requestAnimationFrame(() => titleLink.current?.focus());
  };

  const edited = new Date(board.updatedAt);
  return (
    <li className="board-card">
      <Link to={href} className="thumb" tabIndex={-1} aria-hidden="true">
        {thumb ? <img src={thumb.dataURL} alt="" loading="lazy" decoding="async" /> : <span className="thumb-empty">{board.elementCount ? 'Preview pending' : 'Empty board'}</span>}
      </Link>
      <div className="board-info">
        <div className="board-text">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finish(true);
              }}
            >
              <label className="sr-only" htmlFor={`rename-${board.id}`}>
                Rename board
              </label>
              <input
                ref={input}
                id={`rename-${board.id}`}
                className="input compact rename-input"
                value={draft}
                maxLength={100}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finish(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft(board.title);
                    finish(false);
                  }
                }}
              />
            </form>
          ) : (
            <Link ref={titleLink} to={href} className="board-title">
              {board.title}
            </Link>
          )}
          <span className="muted tiny">
            Edited <time dateTime={edited.toISOString()} title={edited.toLocaleString()}>{relativeTime(board.updatedAt, now)}</time>
          </span>
        </div>
        <Menu
          label={`Actions for ${board.title}`}
          className="btn ghost icon small"
          items={[
            {
              label: 'Rename',
              onSelect: () => {
                setDraft(board.title);
                setRenaming(true);
              },
            },
            { label: 'Duplicate', onSelect: () => actions.duplicate(board.id) },
            { label: 'Download .excalidraw', onSelect: () => actions.download(board.id) },
            { label: 'Delete', onSelect: () => actions.remove(board.id), danger: true },
          ]}
        >
          <IconMore />
        </Menu>
      </div>
    </li>
  );
}
