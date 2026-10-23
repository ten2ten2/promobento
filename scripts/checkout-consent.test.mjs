import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../packages/contracts/index.mjs';
import { checkoutPurchaseIdentity,recordCheckoutConsent } from './checkout-consent.mjs';
const request=()=>({schemaVersion:'3.0.0',kind:'checkout_request',requestId:'request_1',projectId:'project_1',sku:'project_pack',
  purchaseIntent:'top_up_only',consent:{disclosureId:'disclosure_1',acceptedItemIds:['terms','start']}});
const context={actorUserId:'user_1',receiptId:'receipt_1',projectId:'project_1',currentOfferVersion:'offer_1',currentTermsVersion:'terms_1',nowMs:Date.parse('2026-10-21T00:00:00Z')};
const disclosure=()=>({schemaVersion:'3.0.0',kind:'checkout_disclosure_result',disclosureId:'disclosure_1',projectId:'project_1',
  purchaseHash:digest(checkoutPurchaseIdentity(request())),policyVersion:'agent-policy-v1',termsVersion:'terms_1',dependsOnOrderId:null,offerVersion:'offer_1',locale:'en',
  summaryText:'Engineering fixture: project creation allowance. No payment is collected.',expiresAt:'2026-10-21T00:30:00Z',
  items:[{id:'terms',purpose:'terms',text:'I accept the displayed Terms.',required:true},
    {id:'start',purpose:'immediate_performance',text:'I request performance to begin now.',required:true}]});

test('the receipt records server time and the exact purchase, summary and displayed terms',()=>{
  const r=recordCheckoutConsent(request(),disclosure(),context);
  assert.equal(r.disclosureHash,digest(disclosure()));
  assert.equal(r.acceptedAt,new Date(context.nowMs).toISOString());
  assert.equal(r.requestId,'request_1');
  assert.notEqual(digest({...disclosure(),summaryText:'Changed offer'}),r.disclosureHash);
});

test('old or incomplete consent cannot be transplanted to another purchase or offer',()=>{
  const req=request();req.consent.acceptedItemIds=['terms'];
  assert.throws(()=>recordCheckoutConsent(req,disclosure(),context),/CHECKOUT_CONSENT_REQUIRED/);
  assert.throws(()=>recordCheckoutConsent({...request(),sku:'extra_pack'},disclosure(),context),/CHECKOUT_DISCLOSURE_MISMATCH/);
  assert.throws(()=>recordCheckoutConsent(request(),disclosure(),{...context,currentOfferVersion:'offer_2'}),/CHECKOUT_OFFER_CHANGED/);
  assert.throws(()=>recordCheckoutConsent(request(),disclosure(),{...context,nowMs:context.nowMs+1800000}),/CHECKOUT_DISCLOSURE_EXPIRED/);
  assert.throws(()=>recordCheckoutConsent(request(),disclosure(),{...context,projectId:'project_other'}),/CHECKOUT_CONSENT_SCOPE_MISMATCH/);
  const forged=request();forged.consent.acceptedAt='2026-10-01T00:00:00Z';
  assert.throws(()=>recordCheckoutConsent(forged,disclosure(),context),/CHECKOUT_CONSENT_INVALID/);
});

test('terms versions and server-selected dependency orders are part of the frozen purchase',()=>{
  assert.throws(()=>recordCheckoutConsent(request(),disclosure(),{...context,currentTermsVersion:'terms_2'}),/CHECKOUT_TERMS_CHANGED/);
  const req={...request(),sku:'extra_pack'};
  const source='order_creative';
  const shown={...disclosure(),dependsOnOrderId:source,purchaseHash:digest(checkoutPurchaseIdentity(req,source))};
  const accepted=recordCheckoutConsent(req,shown,{...context,dependsOnOrderId:source});
  assert.equal(accepted.dependsOnOrderId,source);
  assert.equal(accepted.termsVersion,'terms_1');
  assert.throws(()=>recordCheckoutConsent(req,shown,{...context,dependsOnOrderId:'another_order'}),/CHECKOUT_DISCLOSURE_MISMATCH/);
  assert.throws(()=>recordCheckoutConsent(req,shown,context),/CHECKOUT_DISCLOSURE_MISMATCH/);
});

test('consent evidence may be recorded for a new explicit attempt without inventing an order',()=>{
  const first=recordCheckoutConsent(request(),disclosure(),context);
  const second=recordCheckoutConsent({...request(),requestId:'request_2'},disclosure(),{...context,receiptId:'receipt_2'});
  assert.equal(first.disclosureHash,second.disclosureHash);
  assert.notEqual(first.requestId,second.requestId);
  assert.equal(Object.hasOwn(second,'orderId'),false);
});
