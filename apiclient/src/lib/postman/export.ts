/** Produces files that real Postman imports without edits. */
import { COLLECTION_SCHEMA_V21, type PmCollection, type PmEnvironmentFile } from './types';

export const EXPORTED_USING = 'API Client/1.0 (rahul654.github.io/apps/apiclient)';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A collection file: v2.1 schema URL, every field kept (ids are schema-legal and let re-import keep identity). */
export function toCollectionFile(c: PmCollection): PmCollection {
  const out = clone(c);
  out.info = { ...out.info, schema: COLLECTION_SCHEMA_V21 };
  return out;
}

export function toEnvironmentFile(env: PmEnvironmentFile, scope: 'environment' | 'globals' = 'environment'): PmEnvironmentFile {
  const out = clone(env);
  return {
    ...out,
    values: out.values.map((v) => ({ key: v.key, value: v.value, type: v.type ?? 'default', enabled: v.enabled !== false, ...(v.description ? { description: v.description } : {}) })),
    _postman_variable_scope: scope,
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: EXPORTED_USING,
  };
}

export function collectionFileName(c: PmCollection): string {
  return `${c.info.name}.postman_collection.json`;
}
export function environmentFileName(e: PmEnvironmentFile): string {
  return `${e.name}.postman_environment.json`;
}
export function globalsFileName(): string {
  return 'workspace.postman_globals.json';
}
