/**
 * Postman Collection v2.1 shapes, used directly as the app's internal model so import/export is
 * lossless. Unknown fields are kept (`[extra: string]: unknown`) and written back on export.
 * Reference: https://schema.postman.com/json/collection/v2.1.0/collection.json
 */

export interface PmDescriptionObject {
  content?: string;
  type?: string;
  version?: unknown;
}
export type PmDescription = string | PmDescriptionObject | null;

export interface PmVariable {
  id?: string;
  key?: string;
  value?: unknown;
  type?: 'string' | 'boolean' | 'any' | 'number' | 'secret' | 'default' | string;
  name?: string;
  description?: PmDescription;
  system?: boolean;
  disabled?: boolean;
  [extra: string]: unknown;
}

export interface PmAuthAttribute {
  key: string;
  value?: unknown;
  type?: string;
  [extra: string]: unknown;
}

export type PmAuthType = 'apikey' | 'awsv4' | 'basic' | 'bearer' | 'digest' | 'edgegrid' | 'hawk' | 'noauth' | 'oauth1' | 'oauth2' | 'ntlm';

export interface PmAuth {
  type: PmAuthType;
  noauth?: unknown;
  apikey?: PmAuthAttribute[];
  awsv4?: PmAuthAttribute[];
  basic?: PmAuthAttribute[];
  bearer?: PmAuthAttribute[];
  digest?: PmAuthAttribute[];
  edgegrid?: PmAuthAttribute[];
  hawk?: PmAuthAttribute[];
  oauth1?: PmAuthAttribute[];
  oauth2?: PmAuthAttribute[];
  ntlm?: PmAuthAttribute[];
  [extra: string]: unknown;
}

export interface PmScript {
  id?: string;
  type?: string;
  exec?: string[] | string;
  src?: PmUrl;
  name?: string;
  packages?: unknown;
  [extra: string]: unknown;
}

export interface PmEvent {
  id?: string;
  listen: 'prerequest' | 'test' | string;
  script?: PmScript;
  disabled?: boolean;
  [extra: string]: unknown;
}

export interface PmHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: PmDescription;
  type?: string;
  [extra: string]: unknown;
}

export interface PmQueryParam {
  key?: string | null;
  value?: string | null;
  disabled?: boolean;
  description?: PmDescription;
  [extra: string]: unknown;
}

export interface PmUrlObject {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  path?: string | (string | { type?: string; value?: string })[];
  port?: string;
  query?: PmQueryParam[];
  hash?: string;
  variable?: PmVariable[];
  [extra: string]: unknown;
}
export type PmUrl = string | PmUrlObject;

export interface PmFormParam {
  key: string;
  value?: string;
  src?: string | string[] | null;
  disabled?: boolean;
  type?: 'text' | 'file' | string;
  contentType?: string;
  description?: PmDescription;
  [extra: string]: unknown;
}

export interface PmUrlEncodedParam {
  key: string;
  value?: string;
  disabled?: boolean;
  description?: PmDescription;
  type?: string;
  [extra: string]: unknown;
}

export type PmBodyMode = 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';

export interface PmBody {
  mode?: PmBodyMode;
  raw?: string;
  urlencoded?: PmUrlEncodedParam[];
  formdata?: PmFormParam[];
  file?: { src?: string | null; content?: string; [extra: string]: unknown };
  graphql?: { query?: string; variables?: string; [extra: string]: unknown };
  options?: { raw?: { language?: 'json' | 'text' | 'xml' | 'html' | 'javascript' | string; [extra: string]: unknown }; [extra: string]: unknown };
  disabled?: boolean;
  [extra: string]: unknown;
}

export interface PmRequestObject {
  url?: PmUrl;
  auth?: PmAuth | null;
  proxy?: unknown;
  certificate?: unknown;
  method?: string;
  description?: PmDescription;
  header?: PmHeader[] | string;
  body?: PmBody | null;
  [extra: string]: unknown;
}
export type PmRequest = string | PmRequestObject;

export interface PmCookie {
  domain: string;
  path: string;
  name?: string;
  value?: string;
  [extra: string]: unknown;
}

export interface PmResponse {
  id?: string;
  name?: string;
  originalRequest?: PmRequest;
  responseTime?: number | string | null;
  timings?: Record<string, unknown> | null;
  header?: (PmHeader | string)[] | string | null;
  cookie?: PmCookie[];
  body?: string | null;
  status?: string;
  code?: number;
  _postman_previewlanguage?: string;
  [extra: string]: unknown;
}

export interface PmItem {
  id?: string;
  name?: string;
  description?: PmDescription;
  variable?: PmVariable[];
  event?: PmEvent[];
  request: PmRequest;
  response?: PmResponse[];
  protocolProfileBehavior?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface PmItemGroup {
  id?: string;
  name?: string;
  description?: PmDescription;
  variable?: PmVariable[];
  item: PmItemOrGroup[];
  event?: PmEvent[];
  auth?: PmAuth | null;
  protocolProfileBehavior?: Record<string, unknown>;
  [extra: string]: unknown;
}
export type PmItemOrGroup = PmItem | PmItemGroup;

export interface PmInfo {
  name: string;
  _postman_id?: string;
  description?: PmDescription;
  version?: unknown;
  schema: string;
  [extra: string]: unknown;
}

export interface PmCollection {
  info: PmInfo;
  item: PmItemOrGroup[];
  event?: PmEvent[];
  variable?: PmVariable[];
  auth?: PmAuth | null;
  protocolProfileBehavior?: Record<string, unknown>;
  [extra: string]: unknown;
}

/** Postman environment / globals export file. */
export interface PmEnvironmentValue {
  key: string;
  value: string;
  type?: 'default' | 'secret' | string;
  enabled?: boolean;
  [extra: string]: unknown;
}
export interface PmEnvironmentFile {
  id?: string;
  name: string;
  values: PmEnvironmentValue[];
  _postman_variable_scope?: 'environment' | 'globals' | string;
  _postman_exported_at?: string;
  _postman_exported_using?: string;
  [extra: string]: unknown;
}

export const COLLECTION_SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
export const COLLECTION_SCHEMA_V20 = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json';

export function isItemGroup(x: PmItemOrGroup): x is PmItemGroup {
  return Array.isArray((x as PmItemGroup).item) && !('request' in x);
}
