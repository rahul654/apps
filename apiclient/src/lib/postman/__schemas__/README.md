# Postman JSON schemas

- `collection-v2.1.0.json` — fetched unmodified from <https://schema.postman.com/json/collection/v2.1.0/collection.json>
  (also published at <https://schema.getpostman.com/json/collection/v2.1.0/collection.json>). Apache License 2.0, © Postman, Inc.
  (see <https://github.com/postmanlabs/schemas>). It is a JSON Schema draft-04 document, so tests validate it with `ajv-draft-04`.
- `environment.json` — Postman does not publish a public schema for environment/globals exports (the
  `schema.postman.com/json/environment/...` URLs return Access Denied). This file is written by this app
  from Postman's documented export format: `{ id, name, values: [{ key, value, type, enabled }], _postman_variable_scope,
  _postman_exported_at, _postman_exported_using }`. It mirrors what Postman's importer accepts; it is not an official artefact.
