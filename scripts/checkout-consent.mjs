// The authenticated checkout controller supplies the immutable disclosure from its own store.
import { readFileSync } from 'node:fs';
import { createSchemaValidator, digest, parseCanonicalJson } from '../packages/contracts/index.mjs';
const schema=parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json',import.meta.url)));
const validate=createSchemaValidator(schema);

export function checkoutPurchaseIdentity(request) {
  return {projectId:request.projectId,sku:request.sku,purchaseIntent:request.purchaseIntent,
    snapshotId:request.snapshotId ?? null,upgradeFromOrderId:request.upgradeFromOrderId ?? null};
}

/** The caller checks owner permission and persists this receipt with the order in one transaction. */
export function recordCheckoutConsent(request,disclosure,{actorUserId,receiptId,projectId,currentOfferVersion,nowMs}={}) {
  if (validate(request,schema.$defs.checkoutRequest).length || validate(disclosure,schema.$defs.checkoutDisclosureResult).length)
    throw Error('CHECKOUT_CONSENT_INVALID');
  if (!actorUserId || !receiptId || projectId !== request.projectId || disclosure.projectId !== projectId)
    throw Error('CHECKOUT_CONSENT_SCOPE_MISMATCH');
  if (request.consent.disclosureId !== disclosure.disclosureId || disclosure.purchaseHash !== digest(checkoutPurchaseIdentity(request)))
    throw Error('CHECKOUT_DISCLOSURE_MISMATCH');
  if (!currentOfferVersion || disclosure.offerVersion !== currentOfferVersion) throw Error('CHECKOUT_OFFER_CHANGED');
  if (!Number.isSafeInteger(nowMs) || Date.parse(disclosure.expiresAt) <= nowMs) throw Error('CHECKOUT_DISCLOSURE_EXPIRED');
  const items=new Map(disclosure.items.map(item=>[item.id,item]));
  if (items.size !== disclosure.items.length || new Set(disclosure.items.map(item=>item.purpose)).size !== disclosure.items.length
    || !disclosure.items.some(item=>item.purpose==='terms' && item.required)) throw Error('CHECKOUT_DISCLOSURE_INVALID');
  const accepted=new Set(request.consent.acceptedItemIds);
  if ([...accepted].some(id=>!items.has(id)) || disclosure.items.some(item=>item.required && !accepted.has(item.id)))
    throw Error('CHECKOUT_CONSENT_REQUIRED');
  const result={schemaVersion:'2.7.0',kind:'checkout_consent_receipt',receiptId,disclosureId:disclosure.disclosureId,
    projectId,actorUserId,requestId:request.requestId,purchaseHash:disclosure.purchaseHash,
    disclosureHash:digest(disclosure),acceptedItemIds:[...accepted].sort(),acceptedAt:new Date(nowMs).toISOString()};
  if (validate(result,schema.$defs.checkoutConsentReceipt).length) throw Error('CHECKOUT_CONSENT_INVALID');
  return result;
}
