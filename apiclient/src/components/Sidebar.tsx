import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { uuid } from '../lib/id';
import { insertItem, moveItem, removeItem, updateItem, countRequests, findItem } from '../lib/postman/items';
import { newRequestItem, removeExample, requestObject, updateExample } from '../lib/postman/edit';
import { collectionId, isItemGroup } from '../lib/postman/normalize';
import { toCollectionFile, collectionFileName } from '../lib/postman/export';
import type { PmCollection, PmItem, PmItemGroup, PmItemOrGroup, PmResponse } from '../lib/postman/types';
import { copyText } from '../lib/clipboard';
import { downloadText } from '../lib/download';
import { getFile } from '../lib/files';
import { copiedMessage, previewRequest } from '../lib/request/preview';
import { toCurl } from '../lib/request/snippets';
import { exampleTabId, openTab, requestTabId, tabRoute } from '../lib/tabs';
import { newCollection, useAppStore } from '../store/AppStore';
import { IconChevron, IconExample, IconFolder, IconMenu, IconMore, IconPlus } from './Icons';
import { EnvironmentSelect } from './Layout';
import { WorkspaceSelect } from './WorkspaceSwitcher';
import { MethodTag, useToast } from './ui';

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  sep?: boolean;
}

function Menu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }} className="tree-actions">
      <button type="button" className="btn ghost small icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconMore size={14} />
      </button>
      {open && (
        <div className="tree-menu" role="menu" style={{ right: 0, top: '100%' }}>
          {items.map((it, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {it.sep && <hr />}
              <button type="button" role="menuitem" className={it.danger ? 'danger' : undefined} onClick={() => {
                setOpen(false);
                it.onClick();
              }}>
                {it.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RenameInline({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="input compact grow"
      value={v}
      aria-label="New name"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

interface TreeProps {
  collection: PmCollection;
  activeId: string | null;
  activeExampleId: string | null;
  expanded: Set<string>;
  toggle: (id: string) => void;
  save: (c: PmCollection) => void;
  /** Double-click: open the tab as a permanent (non-preview) tab. */
  keepOpen: (tabId: string) => void;
  /** "Copy as cURL" for a request (its open tab's unsaved edits included). */
  copyCurl: (item: PmItem, parents: PmItemGroup[]) => void;
}

/** A saved example listed under its request. */
function ExampleNode({ ex, item, depth, ctx }: { ex: PmResponse; item: PmItem; depth: number; ctx: TreeProps }) {
  const { collection, activeExampleId, save, keepOpen } = ctx;
  const [renaming, setRenaming] = useState(false);
  const navigate = useNavigate();
  const cid = collectionId(collection);
  const tabId = exampleTabId(cid, item.id!, ex.id!);
  return (
    <li>
      <div className={activeExampleId === ex.id ? 'tree-row example-row active' : 'tree-row example-row'} style={{ paddingLeft: depth * 8 + 22 }}>
        {renaming ? (
          <RenameInline
            value={ex.name ?? ''}
            onDone={(v) => {
              setRenaming(false);
              if (v && v !== ex.name) save(updateExample(collection, item.id!, { ...ex, name: v }));
            }}
          />
        ) : (
          <Link to={tabRoute(tabId)} className="tree-link" title={`${ex.name} (example${ex.code ? `, ${ex.code}` : ''})`} onDoubleClick={() => keepOpen(tabId)}>
            <IconExample size={14} className="example-icon" />
            <span className="tree-name">{ex.name}</span>
            {ex.code ? <span className="tiny muted">{ex.code}</span> : null}
          </Link>
        )}
        <Menu
          label={`Actions for example ${ex.name}`}
          items={[
            { label: 'Rename', onClick: () => setRenaming(true) },
            {
              label: 'Delete',
              danger: true,
              sep: true,
              onClick: () => {
                if (!window.confirm(`Delete example "${ex.name}"?`)) return;
                save(removeExample(collection, item.id!, ex.id!));
                if (activeExampleId === ex.id) navigate(tabRoute(requestTabId(cid, item.id!)));
              },
            },
          ]}
        />
      </div>
    </li>
  );
}

function TreeNode({ node, parents, depth, ctx }: { node: PmItemOrGroup; parents: PmItemGroup[]; depth: number; ctx: TreeProps }) {
  const { collection, activeId, activeExampleId, expanded, toggle, save, keepOpen, copyCurl } = ctx;
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const cid = collectionId(collection);
  const id = node.id!;
  const parentId = parents.length ? parents[parents.length - 1].id! : null;
  const siblings = parents.length ? parents[parents.length - 1].item : collection.item;
  const index = siblings.indexOf(node);
  const rename = (v: string | null) => {
    setRenaming(false);
    if (v && v !== node.name) save(updateItem(collection, id, (it) => ({ ...it, name: v })));
  };
  const remove = () => {
    const what = isItemGroup(node) ? `folder "${node.name}" and its ${countRequests(node.item)} request(s)` : `request "${node.name}"`;
    if (!window.confirm(`Delete ${what}?`)) return;
    save(removeItem(collection, id));
    if (activeId === id || (isItemGroup(node) && findItem({ ...collection, item: node.item }, activeId ?? ''))) navigate(`/c/${cid}`);
  };
  const duplicate = () => {
    const copy = JSON.parse(JSON.stringify(node)) as PmItemOrGroup;
    const reid = (n: PmItemOrGroup) => {
      n.id = uuid();
      if (isItemGroup(n)) n.item.forEach(reid);
      else n.response?.forEach((r) => (r.id = uuid()));
    };
    reid(copy);
    copy.name = `${node.name} copy`;
    save(insertItem(collection, parentId, copy, index + 1));
  };
  const common: MenuItem[] = [
    { label: 'Rename', onClick: () => setRenaming(true) },
    { label: 'Duplicate', onClick: duplicate },
    { label: 'Move up', onClick: () => save(moveItem(collection, id, parentId, index - 1)) },
    { label: 'Move down', onClick: () => save(moveItem(collection, id, parentId, index + 2)) },
    { label: 'Delete', onClick: remove, danger: true, sep: true },
  ];
  if (isItemGroup(node)) {
    const open = expanded.has(id);
    const addRequest = () => {
      const it = newRequestItem();
      save(insertItem(collection, id, it));
      if (!open) toggle(id);
      keepOpen(requestTabId(cid, it.id!));
      navigate(tabRoute(requestTabId(cid, it.id!)));
    };
    const addFolder = () => {
      const f: PmItemGroup = { id: uuid(), name: 'New folder', item: [] };
      save(insertItem(collection, id, f));
      if (!open) toggle(id);
      navigate(`/f/${cid}/${f.id}`);
    };
    return (
      <li>
        <div className={activeId === id ? 'tree-row active' : 'tree-row'} style={{ paddingLeft: depth * 8 }}>
          <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} onClick={() => toggle(id)}>
            <IconChevron size={14} />
          </button>
          {renaming ? (
            <RenameInline value={node.name ?? ''} onDone={rename} />
          ) : (
            <Link to={`/f/${cid}/${id}`} className="tree-link" title={node.name}>
              <IconFolder size={15} />
              <span className="tree-name">{node.name}</span>
            </Link>
          )}
          <Menu label={`Actions for folder ${node.name}`} items={[{ label: 'Add request', onClick: addRequest }, { label: 'Add folder', onClick: addFolder }, { label: 'Run folder', onClick: () => navigate(`/runner?c=${cid}&f=${id}`) }, ...common]} />
        </div>
        {open && (
          <ul>
            {node.item.map((child) => (
              <TreeNode key={child.id} node={child} parents={[...parents, node]} depth={depth + 1} ctx={ctx} />
            ))}
            {!node.item.length && <li className="tiny muted" style={{ padding: '2px 10px' }}>Empty folder</li>}
          </ul>
        )}
      </li>
    );
  }
  const req = requestObject(node);
  const examples = node.response ?? [];
  const open = examples.length > 0 && expanded.has(id);
  const tabId = requestTabId(cid, id);
  return (
    <li>
      <div className={activeId === id && !activeExampleId ? 'tree-row active' : 'tree-row'} style={{ paddingLeft: depth * 8 + (examples.length ? 0 : 22) }}>
        {examples.length > 0 && (
          <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${examples.length} example${examples.length === 1 ? '' : 's'} of ${node.name}`} onClick={() => toggle(id)}>
            <IconChevron size={14} />
          </button>
        )}
        {renaming ? (
          <RenameInline value={node.name ?? ''} onDone={rename} />
        ) : (
          <Link to={tabRoute(tabId)} className="tree-link" title={`${node.name}${examples.length ? ` · ${examples.length} example${examples.length === 1 ? '' : 's'}` : ''}`} onDoubleClick={() => keepOpen(tabId)}>
            <MethodTag method={req.method ?? 'GET'} />
            <span className="tree-name">{node.name}</span>
          </Link>
        )}
        <Menu label={`Actions for request ${node.name}`} items={[{ label: 'Copy as cURL', onClick: () => copyCurl(node, parents) }, ...common.map((m, i) => (i === 0 ? { ...m, sep: true } : m))]} />
      </div>
      {open && (
        <ul aria-label={`Examples of ${node.name}`}>
          {examples.map((ex) => (
            <ExampleNode key={ex.id} ex={ex} item={node} depth={depth} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({ activeId, activeCollectionId, activeExampleId = null }: { activeId: string | null; activeCollectionId: string | null; activeExampleId?: string | null }) {
  const { state, dispatch, setTabs, drafts } = useAppStore();
  const keepOpen = (tabId: string) => setTabs((t) => openTab(t, tabId));
  const [toast, showToast] = useToast();
  const copyCurl = (collection: PmCollection, item: PmItem, parents: PmItemGroup[]) => {
    const draft = drafts.get(requestTabId(collectionId(collection), item.id!)) as PmItem | undefined;
    const environment = state.environments.find((e) => e.id === state.activeEnvironmentId) ?? null;
    const req = previewRequest({ collection, parents, item: draft ?? item, environment, globals: state.globals, files: getFile });
    copyText(toCurl(req)).then(
      () => showToast(copiedMessage('cURL', req)),
      (e) => showToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const exampleCount = useRef<{ id: string | null; n: number }>({ id: null, n: 0 });
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Auto-expand the path to the active item.
  useEffect(() => {
    if (!activeId || !activeCollectionId) return;
    const c = state.collections.find((x) => collectionId(x) === activeCollectionId);
    if (!c) return;
    const loc = findItem(c, activeId);
    const ids = [activeCollectionId, ...(loc?.parents.map((p) => p.id!) ?? [])];
    if (loc && isItemGroup(loc.item)) ids.push(activeId);
    // An open example shows under its expanded request; so does a newly saved one.
    const count = loc && !isItemGroup(loc.item) ? ((loc.item as PmItem).response?.length ?? 0) : 0;
    const prev = exampleCount.current;
    exampleCount.current = { id: activeId, n: count };
    if (activeExampleId || (prev.id === activeId && count > prev.n)) ids.push(activeId);
    setExpanded((s) => {
      if (ids.every((i) => s.has(i))) return s;
      return new Set([...s, ...ids]);
    });
  }, [activeId, activeCollectionId, activeExampleId, state.collections]);

  const save = (c: PmCollection) => dispatch({ type: 'collection/put', collection: c });
  const create = (name: string | null) => {
    setCreating(false);
    if (!name) return;
    const c = newCollection(name);
    save(c);
    setExpanded((s) => new Set([...s, collectionId(c)]));
    navigate(`/c/${collectionId(c)}`);
  };

  let body: ReactNode;
  if (!state.collections.length && !creating) {
    body = (
      <div className="empty" style={{ padding: '24px 12px' }}>
        <p className="small">No collections yet.</p>
        <button type="button" className="btn primary small" onClick={() => setCreating(true)}>
          <IconPlus size={14} /> New collection
        </button>
        <Link to="/data" className="small">
          Import from Postman
        </Link>
      </div>
    );
  } else {
    body = (
      <ul className="tree" role="tree" aria-label="Collections">
        {creating && (
          <li>
            <div className="tree-row">
              <RenameInline value="New collection" onDone={create} />
            </div>
          </li>
        )}
        {state.collections.map((c) => {
          const cid = collectionId(c);
          const open = expanded.has(cid);
          const addRequest = () => {
            const it = newRequestItem();
            save(insertItem(c, null, it));
            if (!open) toggle(cid);
            keepOpen(requestTabId(cid, it.id!));
            navigate(tabRoute(requestTabId(cid, it.id!)));
          };
          const addFolder = () => {
            const f: PmItemGroup = { id: uuid(), name: 'New folder', item: [] };
            save(insertItem(c, null, f));
            if (!open) toggle(cid);
            navigate(`/f/${cid}/${f.id}`);
          };
          const ctx: TreeProps = { collection: c, activeId, activeExampleId, expanded, toggle, save, keepOpen, copyCurl: (it, ps) => copyCurl(c, it, ps) };
          return (
            <li key={cid}>
              <div className={activeCollectionId === cid && !activeId ? 'tree-row collection-row active' : 'tree-row collection-row'}>
                <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${c.info.name}`} onClick={() => toggle(cid)}>
                  <IconChevron size={14} />
                </button>
                {renamingCol === cid ? (
                  <RenameInline
                    value={c.info.name}
                    onDone={(v) => {
                      setRenamingCol(null);
                      if (v && v !== c.info.name) save({ ...c, info: { ...c.info, name: v } });
                    }}
                  />
                ) : (
                  <Link to={`/c/${cid}`} className="tree-link" title={c.info.name}>
                    <span className="tree-name">{c.info.name}</span>
                  </Link>
                )}
                <Menu
                  label={`Actions for collection ${c.info.name}`}
                  items={[
                    { label: 'Add request', onClick: addRequest },
                    { label: 'Add folder', onClick: addFolder },
                    { label: 'Run collection', onClick: () => navigate(`/runner?c=${cid}`) },
                    { label: 'Export (Postman v2.1)', onClick: () => downloadText(JSON.stringify(toCollectionFile(c), null, 2), collectionFileName(c)) },
                    { label: 'Rename', onClick: () => setRenamingCol(cid) },
                    {
                      label: 'Delete',
                      danger: true,
                      sep: true,
                      onClick: () => {
                        if (!window.confirm(`Delete collection "${c.info.name}" with ${countRequests(c.item)} request(s)?`)) return;
                        dispatch({ type: 'collection/remove', id: cid });
                        if (activeCollectionId === cid) navigate('/');
                      },
                    },
                  ]}
                />
              </div>
              {open && (
                <ul>
                  {c.item.map((child) => (
                    <TreeNode key={child.id} node={child} parents={[]} depth={1} ctx={ctx} />
                  ))}
                  {!c.item.length && (
                    <li className="tiny muted" style={{ padding: '2px 24px' }}>
                      Empty. <button type="button" className="linkish tiny" onClick={addRequest}>Add a request</button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'} aria-label="Collections">
      <div className="sidebar-head">
        <button type="button" className="btn ghost small icon sidebar-toggle" aria-expanded={!collapsed} aria-controls="sidebar-body" aria-label="Toggle collections list" onClick={() => setCollapsed((c) => !c)}>
          <IconMenu size={16} />
        </button>
        <h2>Collections</h2>
        <div className="spacer" />
        <button type="button" className="btn ghost small icon" aria-label="New collection" title="New collection" onClick={() => setCreating(true)}>
          <IconPlus size={16} />
        </button>
      </div>
      {/* On phones the top bar has no room for the pickers, so they live here. */}
      <div className="sidebar-switchers">
        <WorkspaceSelect />
        <EnvironmentSelect compact />
      </div>
      <div className="sidebar-body" id="sidebar-body">
        {body}
      </div>
      {toast}
    </aside>
  );
}
