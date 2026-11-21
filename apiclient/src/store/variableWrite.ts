/**
 * The store action that writes a variable value back to its scope, from the variable popover.
 * Always built from the latest state, so a write never overwrites newer collection/env edits.
 * The `request` scope is the open request's draft and is handled by the editor instead.
 */
import { updateItem } from '../lib/postman/items';
import { collectionId, isItemGroup } from '../lib/postman/normalize';
import { setEnvValue, setPmVariable, type VarTarget } from '../lib/varScope';
import type { Action } from './AppStore';
import type { PmCollection, PmEnvironmentFile } from '../lib/postman/types';

export interface WriteContext {
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile;
  collections: PmCollection[];
}

export function variableWriteAction(s: WriteContext, target: VarTarget, key: string, value: string): Action | null {
  switch (target.kind) {
    case 'environment': {
      const env = s.environments.find((e) => e.id === target.id);
      return env ? { type: 'environment/put', env: { ...env, values: setEnvValue(env.values, key, value) } } : null;
    }
    case 'globals':
      return { type: 'globals/set', globals: { ...s.globals, values: setEnvValue(s.globals.values, key, value) } };
    case 'collection': {
      const c = s.collections.find((x) => collectionId(x) === target.cid);
      return c ? { type: 'collection/put', collection: { ...c, variable: setPmVariable(c.variable, key, value) } } : null;
    }
    case 'folder': {
      const c = s.collections.find((x) => collectionId(x) === target.cid);
      if (!c) return null;
      return { type: 'collection/put', collection: updateItem(c, target.id, (f) => (isItemGroup(f) ? { ...f, variable: setPmVariable(f.variable, key, value) } : f)) };
    }
    case 'request':
      return null;
  }
}
