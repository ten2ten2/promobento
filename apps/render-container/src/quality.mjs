import {run} from './process.mjs';

const number = value => value === undefined ? null : Number(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const between = (value, min, max) => finite(value) && value >= min && value <= max;

/** Parse trusted FFmpeg reports without accepting self-reported model or page metrics. */
export function parseQualitySignals(videoLog, audioLog = null, durationSeconds = 30) {
  const intervals = (text, expression) => [...text.matchAll(expression)].map(match => ({
    startSeconds: number(match[1]), endSeconds: number(match[2]), durationSeconds: number(match[3])
  })).filter(item => between(item.startSeconds, 0, durationSeconds)
    && between(item.endSeconds, item.startSeconds, durationSeconds + .05)
    && finite(item.durationSeconds) && item.durationSeconds >= 0
    && Math.abs(item.endSeconds - item.startSeconds - item.durationSeconds) < .1).slice(0, 80);
  const black = intervals(videoLog, /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/g);
  // FFmpeg logs freeze_start, freeze_duration, freeze_end as separate events, in
  // that order. A freeze still active at EOF has no freeze_end at all.
  const freeze = [];
  let started = null, measured = null;
  const addFreeze = (end, duration) => {
    if (started !== null && between(started, 0, durationSeconds)
      && between(end, started, durationSeconds + .05) && finite(duration)
      && duration >= 0 && Math.abs(end - started - duration) < .1 && freeze.length < 80)
      freeze.push({startSeconds: started, endSeconds: end, durationSeconds: duration});
  };
  for (const [, event, raw] of videoLog.matchAll(/(?:lavfi\.freezedetect\.)?(freeze_start|freeze_duration|freeze_end):\s*([\d.]+)/g)) {
    const value = number(raw);
    if (event === 'freeze_start') {started = value; measured = null;}
    else if (event === 'freeze_duration' && started !== null) measured = value;
    else if (event === 'freeze_end' && started !== null) {
      addFreeze(value, measured ?? value - started);
      started = null; measured = null;
    }
  }
  if (started !== null) addFreeze(durationSeconds, durationSeconds - started);
  const silence = audioLog === null ? [] : intervals(audioLog, /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g);
  const match = audioLog?.match(/\{\s*"input_i"\s*:\s*"([^"]+)"\s*,\s*"input_tp"\s*:\s*"([^"]+)"/);
  const integratedLufs = match ? number(match[1]) : null, truePeakDbtp = match ? number(match[2]) : null;
  return {black, freeze, silence, integratedLufs: finite(integratedLufs) ? integratedLufs : null,
    truePeakDbtp: finite(truePeakDbtp) ? truePeakDbtp : null};
}

/** Findings separate technical blockers from suspicious artistic intervals needing human review. */
export function assessQualitySignals(signals, hasAudio) {
  const findings = [];
  for (const item of signals.black.filter(item => item.durationSeconds >= 0.5))
    findings.push({kind: 'black_segment',severity: 'review',...item});
  for (const item of signals.freeze.filter(item => item.durationSeconds >= 1.5))
    findings.push({kind: 'static_segment',severity: 'review',...item});
  for (const item of signals.silence.filter(item => item.durationSeconds >= 2))
    findings.push({kind: 'silent_segment',severity: 'review',...item});
  if (hasAudio && (signals.integratedLufs === null || signals.truePeakDbtp === null))
    findings.push({kind: 'audio_measurement_unavailable',severity: 'block'});
  else if (hasAudio && (Math.abs(signals.integratedLufs + 14) > 0.5 || signals.truePeakDbtp > -1))
    findings.push({kind: 'audio_loudness_out_of_range',severity: 'block'});
  return findings;
}

// Some FFmpeg demuxer/decoder errors are emitted only on stderr even with
// -xerror and -err_detect explode: the process still exits zero after partial
// H.264 recovery. A claimed full-file scan must reject these diagnostics.
const corruptDecode = /(?:invalid NAL unit size|error splitting the input into NAL units|error submitting packet to decoder|error while decoding (?:stream|MB)|invalid data found when processing input|corrupt decoded frame|decode_slice_header error|invalid frame size|packet corrupt)/i;
function assertDecodedWithoutErrors(log) {
  if (corruptDecode.test(log)) throw Object.assign(Error('MEDIA_DECODE_CORRUPT'), {diagnostic: log.slice(-16000)});
}

/** Full-file decode is measurable evidence, not a claim that anyone watched or liked the film. */
export async function analyzeEncodedQuality(path, composition, hasAudio) {
  try {
    const movie = await run('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'info', '-xerror', '-err_detect', 'explode', '-i', path,
      '-map', '0:v:0', '-vf', 'blackdetect=d=0.4:pix_th=0.10:pic_th=0.98,freezedetect=n=-45dB:d=0.6',
      '-an', '-f', 'null', '-'], {timeoutMs: 180_000, stderrMaxBytes: 256 << 10});
    const soundtrack = hasAudio ? await run('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'info', '-xerror', '-err_detect', 'explode', '-i', path,
      '-map', '0:a:0', '-vn', '-af', 'silencedetect=noise=-40dB:d=0.6,loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
      '-f', 'null', '-'], {timeoutMs: 180_000, stderrMaxBytes: 256 << 10}) : null;
    if (movie.stderrTruncated || soundtrack?.stderrTruncated) throw Error('MEDIA_PROCESS_LOG_TRUNCATED');
    assertDecodedWithoutErrors(movie.stderr);
    if (soundtrack) assertDecodedWithoutErrors(soundtrack.stderr);
    const signals = parseQualitySignals(movie.stderr, soundtrack?.stderr ?? null, composition.durationSeconds);
    const findings = assessQualitySignals(signals, hasAudio);
    return {kind: 'encoded_dynamic_qa',source: 'film.mp4',coverage: hasAudio ? 'full_video_and_audio_decode' : 'full_video_decode_no_audio',
      status: findings.some(item => item.severity === 'block') ? 'blocked' : findings.length ? 'review_required' : 'clear',
      signals,findings,ownerNormalSpeedReview:'pending'};
  } catch (error) {
    // Decode errors, timeouts and truncated logs also need a private QA receipt.
    // No completed scan or measurement is claimed when the tool cannot finish.
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(error?.message || '') ? error.message : 'MEDIA_QUALITY_SCAN_FAILED';
    return {kind: 'encoded_dynamic_qa', source: 'film.mp4', coverage: 'incomplete_decode', status: 'blocked',
      signals: parseQualitySignals('', null, composition.durationSeconds),
      findings: [{kind: 'decode_scan_failed', severity: 'block', code}], ownerNormalSpeedReview: 'pending',
      ...(typeof error?.diagnostic === 'string' ? {diagnostic: error.diagnostic.slice(-16000)} : {})};
  }
}
