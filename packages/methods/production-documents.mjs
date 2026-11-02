import {canonical} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';

const fail = code => { throw Error(code); };
const same = (a, b) => canonical(a) === canonical(b);
const unique = values => new Set(values).size === values.length;
const inWindow = (item, total) => Number.isSafeInteger(item.startFrame) && Number.isSafeInteger(item.endFrame)
  && item.startFrame >= 0 && item.endFrame <= total && item.endFrame > item.startFrame;

/** Model assertions are *not* the truth source: every claimed moment must point to supplied source frames. */
export function assertReferenceAnalysis(analysis, evidence) {
  if (analysis.kind !== 'reference_analysis' || analysis.resourceId !== evidence.resourceId
    || analysis.sourceSha256 !== evidence.sourceSha256 || analysis.sourceFrameCount !== evidence.sourceFrameCount
    || analysis.audioStatus !== 'not_analyzed' || !same(analysis.sampledFrames, evidence.sampledFrames)
    || !unique(analysis.moments.map(moment => moment.id))) fail('REFERENCE_ANALYSIS_SCOPE_INVALID');
  const sample = new Set(evidence.sampledFrames), moments = new Map(analysis.moments.map(moment => [moment.id, moment]));
  for (const moment of analysis.moments) {
    if (!inWindow(moment, evidence.sourceFrameCount) || moment.evidenceFrames.some(frame => !sample.has(frame)
      || frame < moment.startFrame || frame >= moment.endFrame)) fail('REFERENCE_ANALYSIS_EVIDENCE_INVALID');
  }
  for (const link of analysis.relationships) {
    const from = moments.get(link.fromMomentId), to = moments.get(link.toMomentId);
    if (!from || !to || from === to || link.evidenceFrames.some(frame => !sample.has(frame)
      || !(frame >= from.startFrame && frame < from.endFrame
        || frame >= to.startFrame && frame < to.endFrame))) fail('REFERENCE_ANALYSIS_RELATION_INVALID');
  }
  return analysis;
}

const spokenWords = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, '');
function validTiming(timing, frameStart, frameEnd, alignment, spokenText = null) {
  if (timing.kind === 'authored') return;
  const evidence = alignment.find(item => item.sourceSha256 === timing.sourceSha256);
  if (!evidence || timing.firstWord > timing.lastWord || timing.lastWord >= evidence.words.length) fail('SCRIPT_ALIGNMENT_INVALID');
  const start = evidence.words[timing.firstWord].start, end = evidence.words[timing.lastWord].end;
  if (Math.abs(frameStart - Math.round(start * 30)) > 1 || Math.abs(frameEnd - Math.round(end * 30)) > 1)
    fail('SCRIPT_ALIGNMENT_INVALID');
  if (spokenText !== null && (!spokenWords(spokenText) || spokenWords(spokenText) !==
    spokenWords(evidence.words.slice(timing.firstWord, timing.lastWord + 1).map(word => word.text).join(''))))
    fail('SCRIPT_ALIGNMENT_INVALID');
}

/** A single authoritative Script with stable IDs; reference clocks are never target clocks. */
export function assertNativeScript(script, {durationSeconds, videoLanguage, facts, cta, materials, timingEvidence = []}) {
  const total = durationSeconds * 30;
  if (script.kind !== 'native_script' || script.durationFrames !== total || script.videoLanguage !== videoLanguage
    || !unique(script.segments.map(item => item.id)) || !unique(script.moments.map(item => item.id))) fail('SCRIPT_SCOPE_INVALID');
  const factIds = new Set(facts.map(item => item.id)), resources = new Set(materials.map(item => item.resourceId));
  const segments = new Set(script.segments.map(item => item.id));
  for (const item of script.segments) {
    if (!inWindow(item, total) || item.factIds.some(id => !factIds.has(id))
      || (['narration', 'dialogue'].includes(item.role) && !item.speechText)
      || (['title', 'caption', 'cta'].includes(item.role) && item.speechText !== null)
      || !unique(item.factIds)) fail('SCRIPT_SEGMENT_INVALID');
    validTiming(item.timing, item.startFrame, item.endFrame, timingEvidence,
      ['narration', 'dialogue'].includes(item.role) ? item.speechText : null);
  }
  for (const event of script.moments) {
    if (!inWindow(event, total) || event.segmentIds.some(id => !segments.has(id))
      || event.resourceIds.some(id => !resources.has(id)) || !unique(event.segmentIds) || !unique(event.resourceIds))
      fail('SCRIPT_MOMENT_INVALID');
    validTiming(event.timing, event.startFrame, event.endFrame, timingEvidence);
  }
  const measuredSources=new Set(materials.filter(item=>['audio','video'].includes(item.kind))
    .map(item=>canonical([item.resourceId,item.sha256])));
  for (const segment of script.segments) if (['narration','dialogue'].includes(segment.role)
    && segment.timing.kind==='measured' && !script.moments.some(moment=>moment.segmentIds.includes(segment.id)
      &&moment.resourceIds.some(id=>measuredSources.has(canonical([id,segment.timing.sourceSha256])))))
    fail('SCRIPT_ALIGNMENT_INVALID');
  if (typeof cta === 'string' && cta.trim() && !script.segments.some(item => item.role === 'cta' && item.displayText.includes(cta.trim())))
    fail('SCRIPT_CTA_MISSING');
  return script;
}

const normalizedCopy = value => value.replace(/\s+/gu, ' ').trim();
const htmlEntities = text => text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(?:x[\da-f]+|\d+));/gi, entity => {
  const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
  const key = entity.slice(1, -1).toLowerCase();
  if (Object.hasOwn(named, key)) return named[key];
  const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
});

/** The text of adjacent inline elements is one visible phrase, unlike comments, attributes, and scripts. */
function visibleHtmlText(content) {
  const withoutInert = content.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const separated = withoutInert.replace(/<\/?(?:address|article|aside|blockquote|br|div|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|section|table|td|th|tr|ul)\b[^>]*>/gi, ' ');
  return normalizedCopy(htmlEntities(separated.replace(/<[^>]*>/g, '')));
}

/** Native HTML/JS must actually contain display copy, rather than only an inert JSON plan. */
export function assertScriptProjection(files, script) {
  const html = files.filter(file => file.path === 'index.html' || /^src\/.*\.html$/.test(file.path))
    .map(file => visibleHtmlText(file.content));
  // Inspect string literals without evaluating author JavaScript inside the Worker.
  // Escaped quotes, backslashes, hex and Unicode escapes are normal representations
  // of displayed copy (JSON.stringify is a common way to author them).
  const inlineJs = files.filter(file => file.path === 'index.html' || /^src\/.*\.html$/.test(file.path))
    .flatMap(file => [...file.content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
      .filter(([,attrs]) => {
        if (/(?:^|\s)src\s*=/i.test(attrs)) return false;
        const declared = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        if (!declared) return true;
        return ['module','text/javascript','application/javascript','text/ecmascript','application/ecmascript']
          .includes((declared[1] ?? declared[2] ?? declared[3]).trim().toLowerCase());
      }).map(match => match[2]));
  const js = [...files.filter(file => /^(?:index\.js|src\/.*\.js)$/.test(file.path))
    .map(file => file.content), ...inlineJs].join('\n');
  const jsStrings = [...js.matchAll(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g)]
    .map(([literal]) => literal.slice(1, -1).replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([\s\S]))/gi,
      (match, codepoint, unicode, hex, escaped) => {
        if (codepoint || unicode || hex) {
          const number = parseInt(codepoint ?? unicode ?? hex, 16);
          return number <= 0x10ffff ? String.fromCodePoint(number) : match;
        }
        return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v',0:'\0'}[escaped] ?? escaped);
      }));
  for (const segment of script.segments) {
    if (['title', 'caption', 'cta'].includes(segment.role)
      && !html.some(value => value.includes(normalizedCopy(segment.displayText)))
      && !jsStrings.some(value => value.includes(segment.displayText)))
      fail('SCRIPT_SOURCE_PROJECTION_MISSING');
  }
  return true;
}

/** Script-only audio is pinned to an exact admitted version, not every SHA sharing its resource ID. */
export function lockScriptAudioSources(script, materials, selection = null) {
  const selected = new Set((selection?.uses ?? []).map(use => use.resourceId));
  const ids = new Set((script?.moments ?? []).flatMap(moment => moment.resourceIds));
  const locked = [];
  for (const id of ids) {
    if (selected.has(id)) continue;
    const candidates = materials.filter(item => item.kind === 'audio' && item.resourceId === id);
    if (!candidates.length) continue;
    const sources = new Set(candidates.map(item => item.sha256));
    if (sources.size !== 1) fail('SCRIPT_AUDIO_SOURCE_AMBIGUOUS');
    locked.push({resourceId: id, sha256: candidates[0].sha256});
  }
  return locked;
}

/** Each Treatment asset use is bound to one admitted source and locked for the accepted direction. */
export function assertMaterialSelection(plan, treatment, materials) {
  if (plan.kind !== 'material_selection') fail('MATERIAL_SELECTION_INVALID');
  const source = new Map();
  for (const item of materials) {
    if (source.has(item.resourceId) && !same(source.get(item.resourceId), item))
      fail('MATERIAL_SELECTION_SOURCE_AMBIGUOUS');
    source.set(item.resourceId, item);
  }
  const beats = new Map(treatment.beats.map(item => [item.id, item]));
  const expected = [...new Set(treatment.beats.flatMap(beat => beat.assetIds.map(id => canonical([beat.id, id]))))].sort();
  const actual = plan.uses.map(item => canonical([item.beatId, item.selectedResourceId])).sort();
  if (!same(actual, expected) || !unique(actual)) fail('MATERIAL_SELECTION_MISMATCH');
  for (const use of plan.uses) {
    if (!beats.has(use.beatId) || !source.has(use.selectedResourceId) || use.locked !== true
      || use.alternativeResourceIds.includes(use.selectedResourceId)
      || !unique(use.alternativeResourceIds) || use.alternativeResourceIds.some(id => !source.has(id)))
      fail('MATERIAL_SELECTION_MISMATCH');
  }
  const locked = plan.uses.map(use => ({
    beatId: use.beatId, role: use.role, resourceId: use.selectedResourceId,
    sha256: source.get(use.selectedResourceId).sha256, alternatives: use.alternativeResourceIds.map(id => ({
      resourceId: id, sha256: source.get(id).sha256
    })), reason: use.reason, locked: true
  }));
  return {schemaVersion: '3.0.0', kind: 'locked_materials', uses: locked, selectionHash: digest(locked)};
}

export function assertLockedMaterialSelection(selection, resources) {
  if (!selection || selection.kind !== 'locked_materials' || !Array.isArray(selection.uses)
    || selection.schemaVersion !== '3.0.0' || selection.selectionHash !== digest(selection.uses)) fail('MATERIAL_LOCK_IDENTITY_INVALID');
  // Revisions may retain both an old and a new SHA for the same resource ID.
  // Lock identity is the ID/SHA pair, never whichever entry a Map kept last.
  const sources = new Set(resources.map(item => canonical([item.resourceId, item.sourceSha256 ?? item.sha256])));
  for (const use of selection.uses) {
    if (!use.locked || !sources.has(canonical([use.resourceId, use.sha256])) || !Array.isArray(use.alternatives)
      || !unique(use.alternatives.map(item => canonical([item.resourceId, item.sha256])))
      || use.alternatives.some(item => !sources.has(canonical([item.resourceId, item.sha256]))
        || item.resourceId === use.resourceId && item.sha256 === use.sha256))
      fail('MATERIAL_LOCK_IDENTITY_INVALID');
  }
  return selection;
}

/** Project rights refer to frame-pack manifests, but actual author media and timing use original bytes. */
export function projectMaterialSources(project, selection = null, script = null) {
  if (selection) assertLockedMaterialSelection(selection, project.resources);
  const required = new Set((selection?.uses ?? []).map(use => canonical([use.resourceId, use.sha256])));
  const runnable = project.resources.filter(item => item.sourcePath && project.files.some(file =>
    file.path === item.sourcePath && file.sha256 === (item.sourceSha256 ?? item.sha256)));
  const scriptLocks = lockScriptAudioSources(script, runnable.map(item => ({...item, sha256: item.sourceSha256 ?? item.sha256})), selection);
  const scriptRequired = new Set(scriptLocks.map(item => canonical([item.resourceId, item.sha256])));
  const scriptIds = new Set((script?.moments ?? []).flatMap(moment => moment.resourceIds));
  for (const id of scriptIds) if (!(selection?.uses ?? []).some(use => use.resourceId === id)
    && project.resources.some(item => item.resourceId === id && item.kind === 'audio')
    && !scriptLocks.some(item => item.resourceId === id)) fail('MATERIAL_SOURCE_IDENTITY_INVALID');
  return project.resources.flatMap(item => {
    const sha256 = item.sourceSha256 ?? item.sha256;
    if (item.sourceSha256) {
      if (!item.sourcePath) fail('MATERIAL_SOURCE_IDENTITY_INVALID');
      const file = project.files.find(file => file.path === item.sourcePath);
      if (!file) {
        // A replaced source retains its historical rights obligation but no
        // longer has runnable bytes. Only retired, unreferenced sources may be absent.
        if (required.has(canonical([item.resourceId, sha256])) || scriptRequired.has(canonical([item.resourceId, sha256])))
          fail('MATERIAL_SOURCE_IDENTITY_INVALID');
        return [];
      }
      if (file.sha256 !== item.sourceSha256) fail('MATERIAL_SOURCE_IDENTITY_INVALID');
    }
    return [{resourceId: item.resourceId, sha256, path: item.sourcePath ?? null,
      kind: item.kind ?? 'audio', durationSeconds: item.durationSeconds ?? null}];
  });
}

/** Visual media must be selected; Script-referenced licensed audio can also be played. */
export function assertMaterialProjection(files, selection, resources, script = null, scriptAudioLocks = []) {
  if (!selection && !scriptAudioLocks.length) return;
  if (selection) assertLockedMaterialSelection(selection, resources);
  const admitted = new Map(resources.map(item =>
    [canonical([item.resourceId, item.sourceSha256 ?? item.sha256]), item.sourcePath ?? null]));
  const lockedPaths = new Set((selection?.uses ?? []).map(use => admitted.get(canonical([use.resourceId, use.sha256]))));
  const scriptIds = new Set((script?.moments ?? []).flatMap(moment => moment.resourceIds));
  for (const lock of scriptAudioLocks) {
    if (!scriptIds.has(lock.resourceId) || !resources.some(item => item.kind === 'audio'
      && item.resourceId === lock.resourceId && (item.sourceSha256 ?? item.sha256) === lock.sha256))
      fail('SCRIPT_AUDIO_SOURCE_INVALID');
    const path = admitted.get(canonical([lock.resourceId, lock.sha256]));
    if (!path) fail('SCRIPT_AUDIO_SOURCE_INVALID');
    lockedPaths.add(path);
  }
  const text = files.filter(file => /^(?:index\.(?:html|js|css)|src\/.*\.(?:html|js|css|svg|json))$/.test(file.path))
    .map(file => file.content).join('\n');
  for (const [, path] of text.matchAll(/(?:assets\/)([a-f0-9]{24}\.(?:png|jpg|webp|svg|mp4|mov|webm|wav|mp3|m4a|ogg))/g)) {
    if (!lockedPaths.has('assets/' + path)) fail('MATERIAL_LOCK_PROJECT_MISMATCH');
  }
}

/** Replacements are explicit user choices; the source SHA (not a video frame-pack SHA) remains locked. */
export function replaceLockedMaterials(selection, script, replacements, admitted, baseResources, scriptAudioLocks = []) {
  assertLockedMaterialSelection(selection, baseResources);
  if (!Array.isArray(replacements) || !replacements.length
    || !unique(replacements.map(item => item.fromResourceId))
    || !unique(replacements.map(item => item.toResourceId))
    || replacements.some(item => replacements.some(other => item !== other && item.fromResourceId === other.toResourceId)))
    fail('MATERIAL_REPLACEMENT_INVALID');
  const source = new Map(admitted.map(item => [item.resourceId, item]));
  const uses = structuredClone(selection.uses), moments = structuredClone(script?.moments ?? []);
  const segments = structuredClone(script?.segments ?? []), displacedSources = new Set();
  for (const item of replacements) {
    const next = source.get(item.toResourceId);
    if (!next) fail('MATERIAL_REPLACEMENT_INVALID');
    // A user may explicitly replace A with B under the same resource ID.
    // The ID alone is ambiguous unless exactly one old SHA is locked.
    if (item.fromResourceId === item.toResourceId) {
      const oldSha = new Set([
        ...uses.flatMap(use => [use.resourceId === item.fromResourceId ? use.sha256 : null,
          ...use.alternatives.filter(alt => alt.resourceId === item.fromResourceId).map(alt => alt.sha256)]),
        ...scriptAudioLocks.filter(lock => lock.resourceId === item.fromResourceId).map(lock => lock.sha256),
      ].filter(Boolean));
      if (oldSha.size !== 1 || oldSha.has(next.sha256)) fail('MATERIAL_REPLACEMENT_INVALID');
    }
    for (const old of baseResources.filter(resource => resource.resourceId === item.fromResourceId)) {
      const sha = old.sourceSha256 ?? old.sha256;
      if (sha !== next.sha256 && ['audio', 'video'].includes(old.kind)) displacedSources.add(sha);
    }
    let changed = false;
    for (const use of uses) {
      const promoted = use.resourceId === item.fromResourceId;
      const previous = {resourceId: use.resourceId, sha256: use.sha256};
      // Promoting an existing alternative swaps its position with the old
      // selected source; the old source remains a licensed future alternative.
      use.alternatives = use.alternatives.map(alt => {
        if (alt.resourceId === item.fromResourceId) {
          changed = true;
          return {resourceId: next.resourceId, sha256: next.sha256};
        }
        return promoted && alt.resourceId === next.resourceId && alt.sha256 === next.sha256 ? previous : alt;
      });
      if (promoted) {
        use.resourceId = next.resourceId; use.sha256 = next.sha256; changed = true;
      }
      if (use.alternatives.some(alt => alt.resourceId === use.resourceId && alt.sha256 === use.sha256)
        || !unique(use.alternatives.map(alt => canonical([alt.resourceId, alt.sha256])))) fail('MATERIAL_REPLACEMENT_INVALID');
    }
    for (const moment of moments) {
      moment.resourceIds = moment.resourceIds.map(id => {
        if (id !== item.fromResourceId) return id;
        changed = true;
        return next.resourceId;
      });
      if (!unique(moment.resourceIds)) fail('MATERIAL_REPLACEMENT_INVALID');
    }
    if (!changed) fail('MATERIAL_REPLACEMENT_INVALID');
  }
  // A different recording may speak the same words at different timestamps.
  // Never carry its measured clock into the replacement's authored timeline.
  for (const event of [...segments, ...moments])
    if (event.timing?.kind === 'measured' && displacedSources.has(event.timing.sourceSha256))
      event.timing = {kind: 'authored'};
  if (!unique(uses.map(use => canonical([use.beatId, use.resourceId])))) fail('MATERIAL_REPLACEMENT_INVALID');
  const updated = {...selection, uses, selectionHash: digest(uses)};
  return {selection: updated, script: script ? {...script, segments, moments} : null};
}

/** Conservative impact accounting; no existing paid result is regenerated merely to change an unrelated target. */
export function scriptChangeImpact(before, after, aspects, lockedMaterials) {
  const oldSegments = new Map(before.segments.map(item => [item.id, item]));
  const oldMoments = new Map(before.moments.map(item => [item.id, item]));
  const newSegments = new Set(after.segments.map(item => item.id));
  const newMoments = new Set(after.moments.map(item => item.id));
  const segments = [...after.segments.filter(item => !same(oldSegments.get(item.id) ?? null, item)).map(item => item.id),
    ...[...oldSegments.keys()].filter(id => !newSegments.has(id))];
  const moments = [...after.moments.filter(item => !same(oldMoments.get(item.id) ?? null, item)
    || item.segmentIds.some(id => segments.includes(id))).map(item => item.id),
    ...[...oldMoments.keys()].filter(id => !newMoments.has(id))];
  // Reordering authored events or changing Script-level metadata changes the
  // revision even if every individual stable-ID object remains identical.
  const changed = !same(before, after);
  return {kind: 'script_change_impact', changed, segmentIds: segments, momentIds: moments,
    affectedAspects: changed ? [...aspects] : [], affectedAssetLocks: [],
    selectionHash: lockedMaterials?.selectionHash ?? null, qualityReportsReusable: !changed};
}

/** Explicit user-supplied copy edits preserve stable timing IDs but invalidate all prior quality evidence. */
export function applyScriptTextEdits(script, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 8 || !unique(edits.map(item => item.segmentId)))
    fail('SCRIPT_EDITS_INVALID');
  const next = structuredClone(script);
  for (const edit of edits) {
    const segment = next.segments.find(item => item.id === edit.segmentId);
    if (!segment || !['displayText', 'speechText'].includes(edit.field)
      || typeof edit.value !== 'string' || !edit.value.trim() || edit.value.length > 500)
      fail('SCRIPT_EDITS_INVALID');
    if (edit.field === 'speechText' && !['narration', 'dialogue'].includes(segment.role)) fail('SCRIPT_EDITS_INVALID');
    if (edit.field === 'displayText' && ['narration', 'dialogue'].includes(segment.role)) fail('SCRIPT_EDITS_INVALID');
    if (segment[edit.field] === edit.value) continue;
    segment[edit.field] = edit.value;
    segment.timing = {kind: 'authored'};
    for (const moment of next.moments.filter(item => item.segmentIds.includes(segment.id))) moment.timing = {kind: 'authored'};
  }
  if (same(script, next)) fail('SCRIPT_EDITS_NO_CHANGE');
  return next;
}
