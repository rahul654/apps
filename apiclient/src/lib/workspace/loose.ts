/** Loose imports (single files and curl) as a one-group ParsedImport, so they go through the same target picker as zips. */
import { uuid } from '../id';
import { curlToRequest, openApiToCollection, parseOpenApiText } from '../postman/importers';
import { detectPostmanJson } from '../postman/normalize';
import { addJsonToGroup, emptyGroup, type ParsedImport } from './zip';

const stem = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.(json|ya?ml)$/i, '').replace(/\.postman_(collection|environment|globals)$/i, '').trim() || 'Imported';

export async function parseLooseFiles(files: { name: string; text: string }[]): Promise<ParsedImport> {
  const g = emptyGroup('main', files.length === 1 ? stem(files[0].name) : 'Imported');
  const skipped: ParsedImport['skipped'] = [];
  for (const f of files) {
    try {
      if (/\.ya?ml$/i.test(f.name)) {
        g.collections.push(openApiToCollection(await parseOpenApiText(f.text)));
        continue;
      }
      const json: unknown = JSON.parse(f.text);
      if (detectPostmanJson(json) === 'openapi') {
        g.collections.push(openApiToCollection(json as Parameters<typeof openApiToCollection>[0]));
        continue;
      }
      if (detectPostmanJson(json) === null) {
        skipped.push({ file: f.name, reason: 'not recognised (expected a Postman collection, environment, globals or OpenAPI file)' });
        continue;
      }
      const reason = addJsonToGroup(g, f.name, json);
      if (reason) skipped.push({ file: f.name, reason });
    } catch (e) {
      skipped.push({ file: f.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { kind: 'files', groups: [g], skipped, suggestedName: g.name };
}

/** A curl command becomes one request, appended to the target workspace's "Imported" collection. Throws on a bad command. */
export function parseCurlImport(cmd: string): ParsedImport & { requestId: string } {
  const { name, request } = curlToRequest(cmd);
  const g = emptyGroup('main', 'curl');
  const requestId = uuid();
  g.requests = [{ id: requestId, name, request }];
  return { kind: 'files', groups: [g], skipped: [], suggestedName: 'Imported', requestId };
}
