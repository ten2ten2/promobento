import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSchema, semanticErrors, digest} from './contract-validation.mjs';

// Synthetic records exercise reference guards only: no HTTP, upload, media or payment calls.
// These values omit exampleOnly to exercise production input gates, not to claim real evidence.
const clone = value => structuredClone(value);
const projectId = 'project_input_test', workspaceId = 'workspace_input_test';
const now = Date.parse('2026-10-20T12:00:00Z');
const timestamp = '2026-10-20T12:00:00Z', expiresAt = '2026-10-20T12:30:00Z';
const evidenceHash = digest('synthetic evidence bytes');
const uploadHash = digest('synthetic upload bytes');
const voiceHash = digest('synthetic voice bytes');
const otherHash = digest('different synthetic bytes');
const factText = '课程共 8 节。', factHash = digest(factText);
const factRef = {factId:'fact_lessons', version:3, textHash:factHash};
const confirmation = {confirmedBy:'user_input_owner', confirmedAt:timestamp};
const scope = {channels:['website_examples'], purpose:'product_showcase'};
const envelope = (kind, fields) => ({schemaVersion:'3.0.0', kind, ...fields});
const segments = [
  {startMs:0, endMs:3000, text:factText, facts:[factRef]},
  {startMs:3000, endMs:6000, text:'欢迎了解。', facts:[]}
];
const uploadFields = {
  projectId, uploadId:'upload_input_test', assetId:'asset_uploaded', purpose:'visual',
  sourceHash:uploadHash, byteLength:1024, rightsDeclarationId:'rights_input_test'
};

function context() {
  return clone({
    production:true, authorized:true, role:'owner', workspaceId, projectId, now, editables:{},
    rightsNoticeVersion:'rights-v1', showcaseNoticeVersion:'showcase-v1',
    checkoutOrigins:['https://checkout.example.test'],
    assets:{
      asset_evidence:{workspaceId, projectId, sourceHash:evidenceHash, mediaType:'image/png', durationMs:0, purpose:'evidence', state:'ready'},
      asset_voice:{workspaceId, projectId, sourceHash:voiceHash, mediaType:'audio/wav', durationMs:6000, purpose:'voiceover', state:'ready'}
    },
    facts:{fact_lessons:{recordVersion:5, version:3, text:factText, textHash:factHash, confirmation}},
    transcripts:{asset_voice:{version:2}},
    uploadIntents:{upload_input_test:{...uploadFields, workspaceId, contentType:'image/png', expiresAt}},
    uploadObservations:{upload_input_test:{sourceHash:uploadHash, byteLength:1024, mediaType:'image/png'}},
    releases:{release_input_test:{workspaceId, projectId, state:'ready'}},
    showcaseConsents:{},
    orders:{order_input_test:{workspaceId, projectId}}
  });
}

const samples = {
  asset_intent_request:envelope('asset_intent_request', {
    requestId:'request_upload', projectId, purpose:'visual',
    source:{fileName:'screenshot.png', mediaType:'image/png', byteLength:1024, sourceHash:uploadHash},
    rightsDeclaration:{noticeVersion:'rights-v1', basis:'owned', processingAuthorized:true,
      previewAuthorized:true, commercialUseAuthorized:false, peopleRights:'not_applicable', restrictions:null}
  }),
  asset_intent_result:envelope('asset_intent_result', {
    requestId:'request_upload', ...uploadFields, uploadUrl:'https://upload.example.test/object',
    uploadMethod:'PUT', contentType:'image/png', expiresAt
  }),
  upload_complete_request:envelope('upload_complete_request', {
    requestId:'request_complete', uploadId:'upload_input_test'
  }),
  upload_complete_result:envelope('upload_complete_result', {
    requestId:'request_complete', ...uploadFields, state:'processing', jobId:'job_preprocess'
  }),
  facts_update_request:envelope('facts_update_request', {
    requestId:'request_fact_update', projectId,
    changes:[{action:'upsert', factId:'fact_lessons', expectedVersion:5, text:factText,
      evidence:[{assetId:'asset_evidence', sourceHash:evidenceHash}]}]
  }),
  facts_confirm_request:envelope('facts_confirm_request', {
    requestId:'request_fact_confirm', projectId, facts:[{...factRef, expectedRecordVersion:5}]
  }),
  facts_result:envelope('facts_result', {
    projectId,revisionId:null,currentRevisionId:null,unconfirmedFactIds:[],facts:[{...factRef, recordVersion:5, text:factText,
      evidence:[{assetId:'asset_evidence', sourceHash:evidenceHash}],
      evidenceRefs:['evidence_record'], confirmation}]
  }),
  transcript_confirm_request:envelope('transcript_confirm_request', {
    requestId:'request_transcript', projectId, assetId:'asset_voice', sourceHash:voiceHash,
    expectedVersion:2, segments
  }),
  transcript_result:envelope('transcript_result', {
    projectId, assetId:'asset_voice', sourceHash:voiceHash, version:3, segments,
    transcriptHash:digest({assetId:'asset_voice', sourceHash:voiceHash, segments}), ...confirmation
  }),
  showcase_consent_request:envelope('showcase_consent_request', {
    requestId:'request_showcase', projectId, releaseId:'release_input_test', action:'grant',
    expectedVersion:0, scope, noticeVersion:'showcase-v1', authorityConfirmed:true
  }),
  showcase_consent_result:envelope('showcase_consent_result', {
    projectId, releaseId:'release_input_test', state:'not_granted', version:0,
    consentId:null, scope:null, noticeVersion:null, updatedBy:null, updatedAt:null
  }),
  support_ticket_request:envelope('support_ticket_request', {
    requestId:'request_refund', category:'refund', orderId:'order_input_test',
    reason:'delivery_failed', message:'Please review this synthetic delivery failure.'
  }),
  support_ticket_result:envelope('support_ticket_result', {
    requestId:'request_refund', category:'refund', ticketId:'ticket_input_test',
    refundRequestId:'refund_input_test', orderId:'order_input_test', state:'requested', createdAt:timestamp
  }),
  checkout_result:envelope('checkout_result', {
    requestId:'request_checkout', orderId:'order_input_test', projectId,
    orderState:'checkout_open', sessionState:'ready',
    checkoutUrl:'https://checkout.example.test/session/input-test', expiresAt
  })
};

const sample = kind => clone(samples[kind]);
function accepted(value, trusted = context(), label = value.kind) {
  assert.deepEqual(semanticErrors(value, trusted), [], label);
}
function rejected(value, trusted = context(), label = value.kind) {
  assert.ok(semanticErrors(value, trusted).length > 0, label);
}
function rejectChanges(kind, changes) {
  for (const [label, change] of changes) {
    const value = sample(kind), trusted = context();
    accepted(value, trusted, 'valid baseline: '+label);
    change(value, trusted);
    rejected(value, trusted, label);
  }
}

test('all fourteen new API kinds have valid structure and trusted-context examples', () => {
  assert.equal(Object.keys(samples).length, 14);
  for (const value of Object.values(samples)) {
    assert.deepEqual(validateSchema(value), [], value.kind);
    accepted(value);
  }
});

test('legal response variants preserve explicit pending, ready and consent states', () => {
  accepted({...sample('upload_complete_result'), state:'ready', jobId:null});
  accepted({...sample('facts_result'), facts:[]});
  const unconfirmed = sample('facts_result');
  unconfirmed.facts[0].confirmation = null;
  unconfirmed.unconfirmedFactIds = ['fact_lessons'];
  accepted(unconfirmed);
  for (const state of ['granted','revoked']) accepted({...sample('showcase_consent_result'),
    state, version:1, consentId:'consent_input_test', scope, noticeVersion:'showcase-v1',
    updatedBy:'user_input_owner', updatedAt:timestamp});
  const support = envelope('support_ticket_request', {
    requestId:'request_support', category:'support', subject:'Synthetic support', message:'Please help.'
  });
  accepted(support, {...context(), role:'editor'});
  accepted(support, {production:true, authorized:true});
  accepted(envelope('support_ticket_result', {
    requestId:'request_support', category:'support', ticketId:'ticket_support', state:'open', createdAt:timestamp
  }));
  rejected({...sample('upload_complete_result'), jobId:null});
  rejected({...sample('showcase_consent_result'), state:'granted'});
  rejected({...sample('showcase_consent_result'), scope});
});

test('production inputs require current access and trusted scope or records', () => {
  for (const kind of Object.keys(samples).filter(kind => kind.endsWith('_request'))) {
    const value = sample(kind);
    accepted(value);
    rejected(value, {...context(), authorized:false}, kind+' revoked access');
    const missingAuth = context();
    delete missingAuth.authorized;
    rejected(value, missingAuth, kind+' missing authorization');
    if (value.projectId) rejected({...value, projectId:'project_other'}, context(), kind+' project mismatch');
  }
  for (const [kind, key] of [
    ['asset_intent_request','workspaceId'], ['asset_intent_request','projectId'],
    ['asset_intent_request','role'],
    ['upload_complete_request','uploadIntents'], ['upload_complete_request','uploadObservations'],
    ['facts_confirm_request','facts'], ['transcript_confirm_request','assets'],
    ['showcase_consent_request','releases'], ['support_ticket_request','orders'],
    ['checkout_result','checkoutOrigins']
  ]) {
    const trusted = context();
    delete trusted[key];
    rejected(sample(kind), trusted, kind+' missing trusted '+key);
  }
});

test('upload intent requires explicit rights and rejects client-authored confirmation metadata', () => {
  rejectChanges('asset_intent_request', [
    ['missing rights declaration', value => { delete value.rightsDeclaration; }],
    ['missing processing authorization', value => { delete value.rightsDeclaration.processingAuthorized; }],
    ['processing permission denied', value => { value.rightsDeclaration.processingAuthorized=false; }],
    ['forged rights actor', value => { value.rightsDeclaration.confirmedBy='user_forged'; }],
    ['forged rights time', value => { value.rightsDeclaration.confirmedAt=timestamp; }],
    ['unsafe filename', value => { value.source.fileName='../screenshot.png'; }],
    ['undeclared media format', value => { value.source.mediaType='image/svg+xml'; }]
  ]);
});

test('upload purpose and exact per-category byte limits are enforced', () => {
  for (const [purpose, mediaType, limit] of [
    ['visual','image/png',10485760], ['logo','image/png',5242880],
    ['visual','video/mp4',52428800], ['voiceover','audio/wav',10485760],
    ['music','audio/mpeg',10485760]
  ]) {
    const value = sample('asset_intent_request');
    value.purpose=purpose;
    value.source.mediaType=mediaType;
    value.source.byteLength=limit;
    accepted(value);
    value.source.byteLength++;
    rejected(value, context(), purpose+' above byte limit');
  }
  for (const [purpose, mediaType] of [
    ['visual','audio/wav'], ['logo','image/jpeg'], ['logo','video/mp4'], ['voiceover','image/png'], ['music','video/mp4']
  ]) {
    const value = sample('asset_intent_request');
    value.purpose=purpose;
    value.source.mediaType=mediaType;
    rejected(value, context(), purpose+' incompatible with '+mediaType);
  }
});

test('preview authorization and notice version cannot be inferred from upload selection', () => {
  rejectChanges('asset_intent_request', [
    ['preview permission missing', value => { delete value.rightsDeclaration.previewAuthorized; }],
    ['preview permission denied', value => { value.rightsDeclaration.previewAuthorized=false; }],
    ['stale notice', value => { value.rightsDeclaration.noticeVersion='rights-old'; }],
    ['missing trusted notice', (_value, trusted) => { delete trusted.rightsNoticeVersion; }]
  ]);
  const evidence = sample('asset_intent_request');
  evidence.purpose='evidence';
  evidence.rightsDeclaration.previewAuthorized=false;
  accepted(evidence);
});

test('upload completion binds trusted observed bytes, scope, expiry and result identity', () => {
  rejectChanges('upload_complete_request', [
    ['changed source bytes', (_value, trusted) => { trusted.uploadObservations.upload_input_test.sourceHash=otherHash; }],
    ['changed byte length', (_value, trusted) => { trusted.uploadObservations.upload_input_test.byteLength++; }],
    ['mismatched media type', (_value, trusted) => { trusted.uploadObservations.upload_input_test.mediaType='image/jpeg'; }],
    ['other workspace upload', (_value, trusted) => { trusted.uploadIntents.upload_input_test.workspaceId='workspace_other'; }],
    ['other project upload', (_value, trusted) => { trusted.uploadIntents.upload_input_test.projectId='project_other'; }],
    ['expiry boundary', (_value, trusted) => { trusted.now=Date.parse(expiresAt); }],
    ['unknown upload', value => { value.uploadId='upload_unknown'; }]
  ]);
  rejectChanges('upload_complete_result', [
    ['swapped asset', value => { value.assetId='asset_other'; }],
    ['swapped rights record', value => { value.rightsDeclarationId='rights_other'; }],
    ['changed result hash', value => { value.sourceHash=otherHash; }],
    ['changed result purpose', value => { value.purpose='evidence'; }]
  ]);
});

test('fact updates use record CAS even when the content version is unchanged', () => {
  rejectChanges('facts_update_request', [
    ['content version is not record CAS', value => { value.changes[0].expectedVersion=3; }],
    ['concurrent confirmation changed the record', (_value, trusted) => { trusted.facts.fact_lessons.recordVersion++; }],
    ['duplicate fact operations', value => { value.changes.push(clone(value.changes[0])); }],
    ['blank fact text', value => { value.changes[0].text='  \n '; }]
  ]);
  const create = sample('facts_update_request');
  create.changes[0].factId='fact_new';
  create.changes[0].expectedVersion=0;
  accepted(create);
  const remove = sample('facts_update_request');
  remove.changes=[{action:'remove', factId:'fact_lessons', expectedVersion:5}];
  accepted(remove);
  remove.changes[0].expectedVersion=4;
  rejected(remove);
});

test('fact evidence must reference current source bytes in the authorized project', () => {
  rejectChanges('facts_update_request', [
    ['forged evidence hash', value => { value.changes[0].evidence[0].sourceHash=otherHash; }],
    ['missing evidence asset', (_value, trusted) => { delete trusted.assets.asset_evidence; }],
    ['other workspace evidence', (_value, trusted) => { trusted.assets.asset_evidence.workspaceId='workspace_other'; }],
    ['other project evidence', (_value, trusted) => { trusted.assets.asset_evidence.projectId='project_other'; }],
    ['visual asset is not approved evidence', (_value, trusted) => { trusted.assets.asset_evidence.purpose='visual'; }],
    ['evidence is still processing', (_value, trusted) => { trusted.assets.asset_evidence.state='processing'; }]
  ]);
});

test('fact and transcript requests cannot supply server-stamped confirmation fields', () => {
  for (const kind of ['facts_update_request','facts_confirm_request','transcript_confirm_request']) {
    rejectChanges(kind, [
      ['forged confirmedBy on '+kind, value => { value.confirmedBy='user_forged'; }],
      ['forged confirmedAt on '+kind, value => { value.confirmedAt=timestamp; }]
    ]);
  }
  rejectChanges('facts_update_request', [
    ['embedded forged confirmation', value => { value.changes[0].confirmation=clone(confirmation); }]
  ]);
  rejectChanges('facts_confirm_request', [
    ['embedded forged confirming actor', value => { value.facts[0].confirmedBy='user_forged'; }]
  ]);
});

test('fact confirmation binds text hash, content version and current record version', () => {
  rejectChanges('facts_confirm_request', [
    ['stale content version', value => { value.facts[0].version--; }],
    ['forged text hash', value => { value.facts[0].textHash=otherHash; }],
    ['stale record version', value => { value.facts[0].expectedRecordVersion--; }],
    ['missing record version', value => { delete value.facts[0].expectedRecordVersion; }],
    ['changed text behind old stored hash', (_value, trusted) => { trusted.facts.fact_lessons.text='课程共 9 节。'; }],
    ['missing trusted fact', (_value, trusted) => { delete trusted.facts.fact_lessons; }],
    ['duplicate confirmations', value => { value.facts.push(clone(value.facts[0])); }]
  ]);
});

test('fact responses reject inconsistent hashes, confirmation sets and saved revisions', () => {
  rejectChanges('facts_result', [
    ['changed text with old hash', value => { value.facts[0].text='课程共 9 节。'; }],
    ['forged response hash', value => { value.facts[0].textHash=otherHash; }],
    ['duplicate response fact', value => { value.facts.push(clone(value.facts[0])); }],
    ['unknown unconfirmed fact', value => { value.unconfirmedFactIds=['fact_missing']; }],
    ['confirmed fact listed as unconfirmed', value => { value.unconfirmedFactIds=['fact_lessons']; }],
    ['unconfirmed fact omitted', value => { value.facts[0].confirmation=null; }],
    ['unconfirmed fact replaced by an unknown ID', value => {
      value.facts[0].confirmation=null; value.unconfirmedFactIds=['fact_missing'];
    }],
    ['new revision with no current revision', value => { value.revisionId='revision_saved'; }],
    ['new revision disagrees with response snapshot', value => {
      value.revisionId='revision_saved'; value.currentRevisionId='revision_other';
    }]
  ]);
});

test('fact results preserve null revisions and the original response snapshot after a later edit', () => {
  accepted({...sample('facts_result'),revisionId:null,currentRevisionId:'revision_existing'});
  accepted({...sample('facts_result'),facts:[],revisionId:null,currentRevisionId:null});
  const saved={...sample('facts_result'),revisionId:'revision_saved',currentRevisionId:'revision_saved'};
  accepted(saved,{...context(),currentRevisionId:'revision_later',facts:{}});
  const facts=[{...saved.facts[0],confirmation:null},
    {...saved.facts[0],factId:'fact_other',confirmation:null}];
  accepted({...saved,facts,unconfirmedFactIds:['fact_other','fact_lessons']},
    {...context(),currentRevisionId:'revision_later'});
});

test('transcript confirmation binds CAS and the actual scoped audio or video source', () => {
  rejectChanges('transcript_confirm_request', [
    ['stale transcript version', value => { value.expectedVersion--; }],
    ['concurrent transcript change', (_value, trusted) => { trusted.transcripts.asset_voice.version++; }],
    ['forged source hash', value => { value.sourceHash=otherHash; }],
    ['other workspace source', (_value, trusted) => { trusted.assets.asset_voice.workspaceId='workspace_other'; }],
    ['other project source', (_value, trusted) => { trusted.assets.asset_voice.projectId='project_other'; }],
    ['image cannot be a transcript source', (_value, trusted) => { trusted.assets.asset_voice.mediaType='image/png'; }]
  ]);
  const first = sample('transcript_confirm_request'), trusted = context();
  first.expectedVersion=0;
  trusted.transcripts={};
  accepted(first, trusted);
  trusted.assets.asset_voice.mediaType='video/mp4';
  accepted(first, trusted);
});

test('transcript segments are ordered non-overlapping intervals inside source duration', () => {
  rejectChanges('transcript_confirm_request', [
    ['reversed interval', value => { value.segments[0].startMs=3001; }],
    ['zero-length interval', value => { value.segments[0].startMs=3000; }],
    ['overlap', value => { value.segments[1].startMs=2999; }],
    ['out of order', value => { value.segments.reverse(); }],
    ['beyond observed duration', value => { value.segments[1].endMs=6001; }],
    ['no observed duration', (_value, trusted) => { delete trusted.assets.asset_voice.durationMs; }],
    ['blank segment', value => { value.segments[0].text='  '; }]
  ]);
  const value = sample('transcript_confirm_request'), trusted = context();
  trusted.assets.asset_voice.durationMs=60000;
  value.segments[1].endMs=60000;
  accepted(value, trusted);
  value.segments[1].endMs++;
  rejected(value, trusted);
  const bounded = sample('transcript_confirm_request');
  bounded.segments[0].facts=[];
  bounded.segments[0].text='🙂'.repeat(3000);
  bounded.segments[1].text='汉'.repeat(3000);
  accepted(bounded);
  bounded.segments[1].text+='！';
  rejected(bounded, context(), 'combined transcript exceeds 6000 Unicode code points');
});

test('transcript fact links require current confirmed content', () => {
  rejectChanges('transcript_confirm_request', [
    ['unconfirmed fact', (_value, trusted) => { trusted.facts.fact_lessons.confirmation=null; }],
    ['unknown fact', value => { value.segments[0].facts[0].factId='fact_unknown'; }],
    ['stale fact version', value => { value.segments[0].facts[0].version--; }],
    ['stale fact text hash', value => { value.segments[0].facts[0].textHash=otherHash; }],
    ['modified stored fact text', (_value, trusted) => { trusted.facts.fact_lessons.text='课程共 9 节。'; }]
  ]);
});

test('transcript response digest binds source identity and exact segment content', () => {
  rejectChanges('transcript_result', [
    ['forged transcript hash', value => { value.transcriptHash=otherHash; }],
    ['changed segment text with old digest', value => { value.segments[1].text='欢迎查看详情。'; }],
    ['changed valid timing with old digest', value => { value.segments[1].startMs=3001; }],
    ['changed source with old digest', (value, trusted) => {
      value.sourceHash=otherHash;
      trusted.assets.asset_voice.sourceHash=otherHash;
    }]
  ]);
  const changed = sample('transcript_result');
  changed.segments[1].text='欢迎查看详情。';
  changed.transcriptHash=digest({assetId:changed.assetId, sourceHash:changed.sourceHash, segments:changed.segments});
  accepted(changed);
});

test('showcase grant requires readiness while owner-authorized revocation survives readiness changes', () => {
  rejectChanges('showcase_consent_request', [
    ['editor cannot grant', (_value, trusted) => { trusted.role='editor'; }],
    ['other workspace release', (_value, trusted) => { trusted.releases.release_input_test.workspaceId='workspace_other'; }],
    ['release is not ready', (_value, trusted) => { trusted.releases.release_input_test.state='rendering'; }],
    ['concurrent consent', (_value, trusted) => { trusted.showcaseConsents.release_input_test={version:1}; }],
    ['stale showcase notice', value => { value.noticeVersion='showcase-old'; }],
    ['missing trusted showcase notice', (_value, trusted) => { delete trusted.showcaseNoticeVersion; }],
    ['missing explicit authority', value => { delete value.authorityConfirmed; }],
    ['no approved channels', value => { value.scope.channels=[]; }]
  ]);
  const revoke = envelope('showcase_consent_request', {
    requestId:'request_revoke', projectId, releaseId:'release_input_test', action:'revoke', expectedVersion:1
  });
  const trusted = context();
  trusted.showcaseConsents.release_input_test={version:1};
  accepted(revoke, trusted);
  trusted.releases.release_input_test.state='rendering';
  accepted(revoke, trusted);
  rejected(revoke, {...trusted, role:'editor'});
  trusted.showcaseConsents.release_input_test.version++;
  rejected(revoke, trusted);
});

test('refund intake requires order ownership and never reports money already refunded', () => {
  rejectChanges('support_ticket_request', [
    ['editor cannot request refund', (_value, trusted) => { trusted.role='editor'; }],
    ['other workspace order', (_value, trusted) => { trusted.orders.order_input_test.workspaceId='workspace_other'; }],
    ['unknown order', value => { value.orderId='order_unknown'; }],
    ['client-selected refund amount', value => { value.refundAmountMinor=100; }]
  ]);
  rejectChanges('support_ticket_result', [
    ['funds falsely marked refunded', value => { value.state='refunded'; }],
    ['funds falsely marked paid', value => { value.state='paid'; }],
    ['missing refund request identity', value => { delete value.refundRequestId; }]
  ]);
  const support = envelope('support_ticket_request', {
    requestId:'request_support', category:'support', subject:'Synthetic order question', message:'Please review.',
    orderId:'order_input_test'
  });
  accepted(support, {...context(), role:'editor'});
  const trusted = context();
  trusted.orders.order_input_test.workspaceId='workspace_other';
  rejected(support, trusted);
});

test('ready checkout URLs require a trusted exact origin and a future expiry', () => {
  rejectChanges('checkout_result', [
    ['untrusted origin', value => { value.checkoutUrl='https://elsewhere.example.test/session'; }],
    ['lookalike host', value => { value.checkoutUrl='https://checkout.example.test.evil.test/session'; }],
    ['embedded userinfo', value => { value.checkoutUrl='https://user@checkout.example.test/session'; }],
    ['expiry boundary', (_value, trusted) => { trusted.now=Date.parse(expiresAt); }],
    ['expired checkout', value => { value.expiresAt='2026-10-20T11:59:59Z'; }],
    ['missing trusted clock', (_value, trusted) => { delete trusted.now; }]
  ]);
  accepted(sample('checkout_result'), {...context(), now:Date.parse(expiresAt)-1});
});

test('checkout pending or closed responses carry no usable payment URL', () => {
  for (const [sessionState, states] of [
    ['pending',['created','awaiting_confirmation']],
    ['closed',['paid','expired','canceled','review_required']]
  ]) for (const orderState of states) {
    const value = {...sample('checkout_result'), orderState, sessionState, checkoutUrl:null, expiresAt:null};
    accepted(value);
    rejected({...value, checkoutUrl:samples.checkout_result.checkoutUrl}, context(), orderState+' leaks checkout URL');
    rejected({...value, expiresAt}, context(), orderState+' retains expiry');
  }
  rejected({...sample('checkout_result'), orderState:'paid'});
  rejected({...sample('checkout_result'), checkoutUrl:null});
});
