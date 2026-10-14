/** Test-only: validates files against the checked-in Postman schemas (draft-04). */
import Ajv04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import collectionSchema from './__schemas__/collection-v2.1.0.json';
import environmentSchema from './__schemas__/environment.json';

const ajv = new Ajv04({ strict: false, allErrors: true });
addFormats(ajv);
const validateCollectionFn = ajv.compile(collectionSchema);
const validateEnvironmentFn = ajv.compile(environmentSchema);

export function validateCollection(x: unknown): string[] {
  return validateCollectionFn(x) ? [] : (validateCollectionFn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`);
}
export function validateEnvironment(x: unknown): string[] {
  return validateEnvironmentFn(x) ? [] : (validateEnvironmentFn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`);
}
