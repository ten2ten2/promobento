// Trusted-controller contract checks; this module does not perform content moderation.
import { readFileSync } from 'node:fs';
import { createSchemaValidator, parseCanonicalJson } from '../packages/contracts/index.mjs';
const schema=parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json',import.meta.url)));
const validate=createSchemaValidator(schema);

/** receipt must come from trusted storage. A client quality waiver is never an input. */
export function outputSafetyErrors(receipt,subject,{policyVersion,representation,requiredCoverage,nowMs,revokedResultIds=[]}={}) {
  if (!receipt) return ['OUTPUT_SAFETY_REQUIRED'];
  if (receipt.exampleOnly === true) return ['OUTPUT_SAFETY_EXAMPLE_EVIDENCE_FORBIDDEN'];
  if (validate(receipt,schema.$defs.outputSafetyResult).length) return ['OUTPUT_SAFETY_INVALID'];
  const errors=[];
  if (!subject || ['projectId','operationId','revisionId','subjectKind','subjectHash'].some(key => receipt[key] !== subject[key]))
    errors.push('OUTPUT_SAFETY_SCOPE_MISMATCH');
  if (!policyVersion || receipt.policyVersion !== policyVersion) errors.push('OUTPUT_SAFETY_POLICY_CHANGED');
  if (!representation || receipt.representation !== representation) errors.push('OUTPUT_SAFETY_REPRESENTATION_MISMATCH');
  if (!Array.isArray(requiredCoverage) || requiredCoverage.length === 0 || requiredCoverage.some(kind => !receipt.coverage.includes(kind)))
    errors.push('OUTPUT_SAFETY_COVERAGE_INCOMPLETE');
  if (receipt.status !== 'allowed') errors.push('OUTPUT_SAFETY_'+receipt.status.toUpperCase());
  if (!receipt.evidenceRefs.length) errors.push('OUTPUT_SAFETY_EVIDENCE_REQUIRED');
  if (!Number.isSafeInteger(nowMs) || Date.parse(receipt.checkedAt) > nowMs) errors.push('OUTPUT_SAFETY_TIME_INVALID');
  if (revokedResultIds.includes(receipt.resultId)) errors.push('OUTPUT_SAFETY_REVOKED');
  return errors;
}
