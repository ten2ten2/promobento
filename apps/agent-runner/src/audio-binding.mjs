import {canonical} from '../../../packages/contracts/index.mjs';
import {admittedMediaCatalog} from '../../renderer/src/admission-media.mjs';

const eventValues=event=>({eventId:event.eventId,kind:event.kind,frameStart:event.frameStart,frameEndExclusive:event.frameEndExclusive,
  sourceOffsetFrames:event.sourceOffsetFrames??0,gainDb:event.gainDb??0,fadeInFrames:event.fadeInFrames??0,fadeOutFrames:event.fadeOutFrames??0,
  // Automation is an additive envelope; omitted means 0 dB throughout, not gainDb.
  gainAutomation:event.gainAutomation??[{frameOffset:0,gainDb:0},{frameOffset:event.frameEndExclusive-event.frameStart,gainDb:0}]});

export function assertAudioPlanResources(plan,resources) {
  const catalog=admittedMediaCatalog().resources,events=resources?.audioEvents;
  if(!Array.isArray(events)||plan.events.length!==events.length)throw Error('LOCAL_AGENT_AUDIO_PLAN_MISMATCH');
  for(const [index,event] of plan.events.entries()) {
    const frozen=events[index],resource=catalog.find(resource=>resource.id===frozen.sourceId&&resource.mediaType==='audio/wav');
    if(!resource||event.licenseRef!==resource.licenseRef||canonical(eventValues(event))!==canonical(eventValues(frozen)))
      throw Error('LOCAL_AGENT_AUDIO_PLAN_MISMATCH');
  }
}
export function assertAudioPlanFrozen(plan,frozenEvents) {
  if(!plan.events.length&&(!frozenEvents||!frozenEvents.length))return;
  if(!Array.isArray(frozenEvents)||plan.events.length!==frozenEvents.length)throw Error('LOCAL_AGENT_AUDIO_PLAN_SOURCE_MISMATCH');
  for(const event of plan.events) {
    const frozen=frozenEvents.find(item=>item.eventId===event.eventId);
    if(!frozen||canonical(eventValues(event))!==canonical(eventValues(frozen))||event.licenseRef!==frozen.licenseRef||
      (event.sourceHash!==undefined&&event.sourceHash!==frozen.sourceHash))throw Error('LOCAL_AGENT_AUDIO_PLAN_SOURCE_MISMATCH');
  }
}
