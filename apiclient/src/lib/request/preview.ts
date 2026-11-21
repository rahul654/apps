/**
 * The request as it would be sent right now (variables resolved with the active environment,
 * inherited auth applied), without running scripts. Used for code snippets and "Copy as cURL".
 */
import { scopedVariables } from '../postman/items';
import type { PmCollection, PmEnvironmentFile, PmItem, PmItemGroup } from '../postman/types';
import { varsFromList } from '../variables';
import { buildRequest, type FileLookup, type PreparedRequest } from './build';

export interface PreviewInput {
  collection: PmCollection;
  parents: PmItemGroup[];
  item: PmItem;
  environment: PmEnvironmentFile | null;
  globals: PmEnvironmentFile;
  files?: FileLookup;
}

export function previewScopes({ collection, parents, item, environment, globals }: PreviewInput) {
  return {
    environment: environment ? varsFromList(environment.values) : {},
    collectionChain: scopedVariables(collection, parents, item).map(varsFromList),
    globals: varsFromList(globals.values),
  };
}

export function previewRequest(input: PreviewInput): PreparedRequest {
  return buildRequest(input.item, { scopes: previewScopes(input), parents: input.parents, collection: input.collection, files: input.files });
}

/** Toast text after copying a snippet: what the user should know about the copied command. */
export function copiedMessage(what: string, req: PreparedRequest): string {
  const notes: string[] = [];
  if (req.missing.length) notes.push(`unresolved: ${req.missing.map((m) => `{{${m}}}`).join(', ')}`);
  if (req.warnings.length) notes.push(req.warnings.join(' '));
  return notes.length ? `${what} copied · ${notes.join(' · ')}` : `${what} copied`;
}
