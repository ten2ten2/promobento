// Original procedural score and waveforms; CC0-1.0, see LICENSE.txt beside this file.
// No samples, speech, models or external recordings are used by this fixture.
export const fixtureAudioMarkers = Object.freeze([
  Object.freeze({id:'sound_open',frame:30,label:'Open',audioEventId:'cue_open'}),
  Object.freeze({id:'sound_focus',frame:300,label:'Focus',audioEventId:'cue_focus'}),
  Object.freeze({id:'sound_finish',frame:600,label:'Finish',audioEventId:'cue_finish'})
]);

export const fixtureCueFrequency = 3600;

/** Absolute sample addressing; oscillator state never depends on iteration order. */
export function synthesizeFixtureAudio(durationSeconds=30) {
  if (durationSeconds!==30) throw new Error('AUDIO_FIXTURE_DURATION_INVALID');
  const sampleRate=48000,channels=2;
  const music=new Float64Array(durationSeconds*sampleRate*channels);
  const chords=[[110,138.591315,164.813778],[130.812783,164.813778,195.997718],
    [97.998859,123.470825,146.832384],[116.54094,146.832384,174.614116]];
  for (let sample=0;sample<music.length/channels;sample++) {
    const time=sample/sampleRate,chord=chords[Math.floor(time/4)%chords.length];
    // Smooth transitions suppress clicks; the sustained base keeps the long tail audible.
    const chordTime=time%4,envelope=0.5+0.5*Math.sin(Math.PI*Math.min(chordTime,4-chordTime)/4)**2;
    const pulse=0.8+0.2*Math.sin(2*Math.PI*time)**2;
    const tone=chord.reduce((sum,hz,index)=>sum+Math.sin(2*Math.PI*hz*time)/(index+2),0);
    const base=0.035*Math.sin(2*Math.PI*55*time);
    music[sample*2]=base+0.13*tone*envelope*pulse;
    music[sample*2+1]=base+0.13*tone*envelope*pulse*0.97;
  }
  const cue=new Float64Array(6*1600*channels);
  for (let sample=0;sample<cue.length/channels;sample++) {
    const time=sample/sampleRate,envelope=Math.min(1,time/0.002)*Math.exp(-time*18);
    const tone=0.25*Math.sin(2*Math.PI*fixtureCueFrequency*time)*envelope;
    cue[sample*2]=tone;cue[sample*2+1]=tone;
  }
  return {sampleRate,channels,music,cue};
}
