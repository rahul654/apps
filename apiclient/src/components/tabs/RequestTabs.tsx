/**
 * Postman-style tab strip above the editor. Tabs scroll horizontally; a preview tab is italic;
 * unsaved tabs show a dot (× on hover). Close with ×, middle-click or Delete; right-click (or the
 * Menu key / Shift+F10) for close others / to the right / all. Closing unsaved tabs asks
 * Save / Don't save / Cancel. The URL drives the selected tab (see RequestsPage).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uuid } from '../../lib/id';
import { newUntitledItem } from '../../lib/postman/edit';
import type { PmItem } from '../../lib/postman/types';
import { closeTabs, newTabId, openTab, otherTabIds, parseTabId, pinTab, tabIdsToRight, tabRoute } from '../../lib/tabs';
import { useAppStore } from '../../store/AppStore';
import { dropRuntime, runtimeKey } from '../../store/tabRuntime';
import { IconClose, IconExample, IconMore, IconPlus } from '../Icons';
import { Modal } from '../Modal';
import { MethodTag } from '../ui';
import { SaveRequestDialog } from './SaveRequestDialog';
import { tabInfo, useTabActions } from './useTabActions';

interface MenuState {
  id: string | null;
  x: number;
  y: number;
}

export function RequestTabs({ routeTabId }: { routeTabId: string | null }) {
  const { state, drafts, setDraft, setTabs, getState } = useAppStore();
  const navigate = useNavigate();
  const { saveTab, saveNewRequest } = useTabActions();
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; dirty: string[] } | null>(null);
  const [saveNew, setSaveNew] = useState<{ id: string; thenClose: string[] } | null>(null);
  const tabs = state.tabs.tabs;
  const ws = state.activeWorkspaceId;
  const info = (id: string) => tabInfo(state, drafts, id);

  useEffect(() => {
    strip.current?.querySelector('.req-tab.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [routeTabId, tabs.length]);

  const doClose = (ids: string[]) => {
    if (!ids.length) return;
    for (const id of ids) {
      setDraft(id, undefined);
      dropRuntime(runtimeKey(ws, id));
    }
    const next = closeTabs(getState().tabs, ids);
    setTabs(() => next);
    if (routeTabId && ids.includes(routeTabId)) navigate(next.activeId ? tabRoute(next.activeId) : '/');
  };
  const close = (ids: string[]) => {
    const dirty = ids.filter((id) => info(id).dirty);
    if (dirty.length) setConfirm({ ids, dirty });
    else doClose(ids);
  };
  const saveAndClose = () => {
    if (!confirm) return;
    const { ids, dirty } = confirm;
    setConfirm(null);
    const newOnes = dirty.filter((id) => parseTabId(id)?.kind === 'new');
    for (const id of dirty) if (!newOnes.includes(id)) saveTab(id);
    if (newOnes.length === 1 && ids.length === 1) {
      setSaveNew({ id: newOnes[0], thenClose: [] });
      return;
    }
    // New requests need a collection each; leave them open.
    doClose(ids.filter((id) => !newOnes.includes(id)));
  };
  const newTab = () => {
    const id = newTabId(uuid());
    setDraft(id, newUntitledItem());
    setTabs((s) => openTab(s, id));
    navigate(tabRoute(id));
  };
  const openMenu = (id: string | null, x: number, y: number) => setMenu({ id, x: Math.min(x, window.innerWidth - 220), y });

  useEffect(() => {
    if (!menu) return;
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest?.('.tab-menu')) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    window.addEventListener('blur', off);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
      window.removeEventListener('blur', off);
    };
  }, [menu]);
  useEffect(() => {
    if (menu) document.querySelector<HTMLElement>('.tab-menu [role=menuitem]')?.focus();
  }, [menu]);

  const menuItems = (id: string | null): { label: string; run: () => void; disabled?: boolean }[] => {
    const t = getState().tabs;
    const current = id ?? routeTabId;
    const preview = id ? t.tabs.find((x) => x.id === id)?.preview : false;
    return [
      ...(id ? [{ label: 'Close', run: () => close([id]) }] : [{ label: 'New request', run: newTab }]),
      ...(preview && id ? [{ label: 'Keep open', run: () => setTabs((s) => pinTab(s, id)) }] : []),
      { label: 'Close others', run: () => current && close(otherTabIds(t, current)), disabled: !current || t.tabs.length < 2 },
      ...(id ? [{ label: 'Close tabs to the right', run: () => close(tabIdsToRight(t, id)), disabled: !tabIdsToRight(t, id).length }] : []),
      { label: 'Close saved tabs', run: () => close(t.tabs.filter((x) => !info(x.id).dirty).map((x) => x.id)), disabled: !t.tabs.length },
      { label: 'Close all', run: () => close(t.tabs.map((x) => x.id)), disabled: !t.tabs.length },
    ];
  };

  const focusTab = (i: number) => {
    const id = tabs[(i + tabs.length) % tabs.length]?.id;
    if (!id) return;
    navigate(tabRoute(id));
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"] [role=tab]`)?.focus());
  };

  const confirmNames = confirm?.dirty.map((id) => info(id).title) ?? [];
  const saveNewDraft = saveNew ? (drafts.get(saveNew.id) as PmItem | undefined) : undefined;
  return (
    <div className="req-tabs-bar">
      <div className="req-tabs" role="tablist" aria-label="Open requests" ref={strip}>
        {tabs.map((t, i) => {
          const inf = info(t.id);
          const selected = t.id === routeTabId;
          const focusable = selected || (!tabs.some((x) => x.id === routeTabId) && i === 0);
          return (
            <div
              key={t.id}
              data-tab={t.id}
              className={['req-tab', selected && 'active', t.preview && 'preview', inf.dirty && 'dirty'].filter(Boolean).join(' ')}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // no autoscroll
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close([t.id]);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(t.id, e.clientX, e.clientY);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={focusable ? 0 : -1}
                className="req-tab-main"
                title={`${inf.title}${t.preview ? ' (preview: double-click to keep open)' : ''}${inf.dirty ? ' (unsaved changes)' : ''}`}
                onClick={() => navigate(tabRoute(t.id))}
                onDoubleClick={() => setTabs((s) => pinTab(s, t.id))}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') focusTab(i + 1);
                  else if (e.key === 'ArrowLeft') focusTab(i - 1);
                  else if (e.key === 'Home') focusTab(0);
                  else if (e.key === 'End') focusTab(tabs.length - 1);
                  else if (e.key === 'Delete') close([t.id]);
                  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    const r = e.currentTarget.getBoundingClientRect();
                    openMenu(t.id, r.left, r.bottom);
                  } else return;
                  e.preventDefault();
                }}
              >
                {inf.kind === 'example' ? <IconExample size={13} className="req-tab-icon" /> : <MethodTag method={inf.method ?? 'GET'} />}
                <span className="req-tab-title">{inf.title}</span>
                {inf.dirty && <span className="sr-only">, unsaved changes</span>}
              </button>
              <button type="button" className="req-tab-close" tabIndex={-1} aria-label={`Close ${inf.title}${inf.dirty ? ' (unsaved changes)' : ''}`} title="Close (middle-click)" onClick={() => close([t.id])}>
                <span className="req-tab-dot" aria-hidden="true" />
                <IconClose size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn ghost small icon" aria-label="New request tab" title="New request" onClick={newTab}>
        <IconPlus size={15} />
      </button>
      <button
        type="button"
        className="btn ghost small icon"
        aria-label="Tab actions"
        aria-haspopup="menu"
        aria-expanded={!!menu && menu.id === null}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(null, r.right - 200, r.bottom);
        }}
      >
        <IconMore size={15} />
      </button>
      {menu && (
        <div className="tree-menu tab-menu" role="menu" style={{ position: 'fixed', left: Math.max(8, menu.x), top: menu.y }}>
          {menuItems(menu.id).map((m) => (
            <button
              key={m.label}
              type="button"
              role="menuitem"
              disabled={m.disabled}
              onClick={() => {
                setMenu(null);
                m.run();
              }}
              onKeyDown={(e) => {
                const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])];
                const i = items.indexOf(e.currentTarget);
                if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
                else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
                else return;
                e.preventDefault();
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {confirm && (
        <Modal
          title={confirm.dirty.length === 1 ? 'Save changes?' : `${confirm.dirty.length} tabs have unsaved changes`}
          onCancel={() => setConfirm(null)}
          initialFocus=".btn.primary"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={() => {
                const ids = confirm.ids;
                setConfirm(null);
                doClose(ids);
              }}>
                Don’t save
              </button>
              <button type="button" className="btn primary" onClick={saveAndClose}>
                {confirm.dirty.length === 1 ? 'Save' : 'Save all'}
              </button>
            </>
          }
        >
          <p className="small">
            {confirm.dirty.length === 1 ? (
              <>
                “{confirmNames[0]}” has unsaved changes. Save them before closing?
              </>
            ) : (
              <>Unsaved: {confirmNames.map((n) => `“${n}”`).join(', ')}. New requests that aren’t in a collection yet stay open when you save all.</>
            )}
          </p>
        </Modal>
      )}
      {saveNew && saveNewDraft && (
        <SaveRequestDialog
          initialName={saveNewDraft.name ?? 'New request'}
          collections={state.collections}
          onCancel={() => setSaveNew(null)}
          onSave={(o) => {
            const id = saveNew.id;
            setSaveNew(null);
            const rid = saveNewRequest(id, o, false);
            if (!rid) return;
            // Saved into the collection; now finish closing it.
            const next = closeTabs(getState().tabs, [rid]);
            setTabs(() => next);
            if (id === routeTabId) navigate(next.activeId ? tabRoute(next.activeId) : '/', { replace: true });
          }}
        />
      )}
    </div>
  );

}
