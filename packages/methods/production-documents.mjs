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
  const sample = new Set(evidence.sampledFrames), moments = new Set(analysis.moments.map(moment => moment.id));
  for (const moment of analysis.moments) {
    if (!inWindow(moment, evidence.sourceFrameCount) || moment.evidenceFrames.some(frame => !sample.has(frame)
      || frame < moment.startFrame || frame >= moment.endFrame)) fail('REFERENCE_ANALYSIS_EVIDENCE_INVALID');
  }
  for (const link of analysis.relationships) {
    if (!moments.has(link.fromMomentId) || !moments.has(link.toMomentId)
      || link.evidenceFrames.some(frame => !sample.has(frame))) fail('REFERENCE_ANALYSIS_RELATION_INVALID');
  }
  return analysis;
}

function validTiming(timing, frameStart, frameEnd, alignment) {
  if (timing.kind === 'authored') return;
  const evidence = alignment.find(item => item.sourceSha256 === timing.sourceSha256);
  if (!evidence || timing.firstWord > timing.lastWord || timing.lastWord >= evidence.words.length) fail('SCRIPT_ALIGNMENT_INVALID');
  const start = evidence.words[timing.firstWord].start, end = evidence.words[timing.lastWord].end;
  if (Math.abs(frameStart - Math.round(start * 30)) > 1 || Math.abs(frameEnd - Math.round(end * 30)) > 1)
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
    validTiming(item.timing, item.startFrame, item.endFrame, timingEvidence);
  }
  for (const event of script.moments) {
    if (!inWindow(event, total) || event.segmentIds.some(id => !segments.has(id))
      || event.resourceIds.some(id => !resources.has(id)) || !unique(event.segmentIds) || !unique(event.resourceIds))
      fail('SCRIPT_MOMENT_INVALID');
    validTiming(event.timing, event.startFrame, event.endFrame, timingEvidence);
  }
  if (typeof cta === 'string' && cta.trim() && !script.segments.some(item => item.role === 'cta' && item.displayText.includes(cta.trim())))
    fail('SCRIPT_CTA_MISSING');
  return script;
}

/** Native HTML/JS must actually contain display copy, rather than only an inert JSON plan. */
export function assertScriptProjection(files, script) {
  const source = files.filter(file => file.path === 'index.html' || /^src\/.*\.(?:html|js)$/.test(file.path))
    .map(file => file.content).join('\n');
  for (const segment of script.segments) {
    if (['title', 'caption', 'cta'].includes(segment.role) && !source.includes(segment.displayText))
      fail('SCRIPT_SOURCE_PROJECTION_MISSING');
  }
  return true;
}

/** Each Treatment asset use is bound to one admitted source and locked for the accepted direction. */
export function assertMaterialSelection(plan, treatment, materials) {
  if (plan.kind !== 'material_selection') fail('MATERIAL_SELECTION_INVALID');
  const source = new Map(materials.map(item => [item.resourceId, item]));
  if (materials.some(item => source.get(item.resourceId)?.sha256 !== item.sha256))
    fail('MATERIAL_SELECTION_SOURCE_AMBIGUOUS');
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
  const sources = new Map(resources.map(item => [item.resourceId, item.sha256]));
  for (const use of selection.uses) {
    if (!use.locked || sources.get(use.resourceId) !== use.sha256 || !Array.isArray(use.alternatives)
      || use.alternatives.some(item => sources.get(item.resourceId) !== item.sha256))
      fail('MATERIAL_LOCK_IDENTITY_INVALID');
  }
  return selection;
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
  const changed = segments.length > 0 || moments.length > 0
    || before.segments.length !== after.segments.length || before.moments.length !== after.moments.length;
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
    segment[edit.field] = edit.value;
    segment.timing = {kind: 'authored'};
    for (const moment of next.moments.filter(item => item.segmentIds.includes(segment.id))) moment.timing = {kind: 'authored'};
  }
  if (same(script, next)) fail('SCRIPT_EDITS_NO_CHANGE');
  return next;
}
