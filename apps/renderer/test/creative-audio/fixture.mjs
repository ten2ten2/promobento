import {generatedAudioRequestHash} from '../../src/creative-audio/index.mjs';

/** Original engineering melody, not a confirmation on behalf of a customer. */
export function creativeAudioFixture(totalFrames=450) {
  const score={id:'composed-study',kind:'abc_score',algorithmVersion:'huashu-audio-v1',seed:20261022,marks:[],
    abc:'X:1\nT:Original sampler admission study\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\n'
    +'V:lead inst=vsco_marimba role=melody gain=1\nC2 E2 G2 D2 | E2 G2 c4 | A2 G2 E2 D2 | C2 E2 G4 | E2 D2 C4 | G2 E2 C4 |\n'
    +'V:string inst=vsco_violin gain=0.55\nE4 G4 | E4 c4 | A4 E4 | G4 E4 | E4 D4 | E4 C4 |\n'
    +'V:flute inst=vsco_flute gain=0.5\nz8 | c2 G2 E4 | z8 | G2 E2 D4 | z8 | E2 G2 C4 |'};
  const cue={id:'composed-impact',kind:'sfx',algorithmVersion:'huashu-audio-v1',seed:24,effect:'impact',kit:'clean',durationFrames:27,pitch:1};
  return {generatedAudio:[score,cue],resourceIds:[score.id,cue.id],audioEvents:[
    {eventId:'composed-music',kind:'music',sourceId:score.id,frameStart:0,frameEndExclusive:totalFrames,sourceOffsetFrames:0,gainDb:0,fadeInFrames:3,fadeOutFrames:15},
    {eventId:'composed-hit',kind:'sfx',sourceId:cue.id,frameStart:180,frameEndExclusive:210,sourceOffsetFrames:0,gainDb:-12,fadeInFrames:0,fadeOutFrames:3}],
    audioRights:{schemaVersion:'2.7.0',kind:'admission_audio_rights',approvals:[{sourceId:score.id,requestHash:generatedAudioRequestHash(score,totalFrames),
      basis:'original_composition_reviewed',evidenceRef:'original-engineering-sampler-study',reviewer:'PromoBento engineering fixture',allowedUses:['process','mix','preview','export']}]}};
}
