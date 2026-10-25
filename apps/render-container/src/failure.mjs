import {filesystemDiagnostic} from './memory.mjs';

/** Keep the innermost trusted stage. Never include source text, URLs, headers or raw errors. */
export async function inRenderPhase(phase,work){
 try{return await work();}catch(error){
  if(!(error instanceof Error))error=Error('RENDER_INTERNAL_ERROR');
  error.renderPhase??=phase;throw error;
 }
}

const phases=new Set(['chromium_start','broker_input_read','browser_session','browser_connect','browser_context','page_load','runtime_ready','runtime_init','frame_seek','frame_capture','cold_seam','last_seam',
 'encoder_write','encoder_drain','frame_observation','observation_capture','chromium_stop','assemble_inputs','media_assemble','audio_render','output_upload']);
const systemCodes=new Set(['ENOENT','EACCES','ENOSPC','EROFS','EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN',
 'UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
export function renderFailureDiagnostic(error){
 const stage=error.renderPhase,phase=phases.has(stage?.phase)?stage.phase:null;
 const result={phase,type:['Error','TypeError','RangeError','TimeoutError','AbortError'].includes(error.name)?error.name:'Error'};
 const runtimeCode=['TEXT_FIT_FAILED','FONT_RIGHTS_OR_FACE_MISSING','FRAME_OUT_OF_RANGE','RENDER_PAGE_CRASHED','WEBGL_CONTEXT_UNAVAILABLE','FRAME_ACK_MISMATCH']
  .find(code=>new RegExp('(?:^|\\b)'+code+'(?::|\\b)').test(error.message));
 if(runtimeCode)result.runtimeCode=runtimeCode;
 if(Number.isInteger(stage?.frame)&&stage.frame>=0&&stage.frame<900)result.frame=stage.frame;
 const code=systemCodes.has(error.code)?error.code:systemCodes.has(error.cause?.code)?error.cause.code:null;
 if(code)result.systemCode=code;
 if(['read','write','open','connect','getaddrinfo'].includes(error.syscall))result.syscall=error.syscall;
 const filesystem=filesystemDiagnostic(error);if(filesystem)result.filesystem=filesystem;
 if(['ffmpeg','ffprobe'].includes(error.command)){
  result.media={command:error.command,exitCode:Number.isInteger(error.code)?error.code:null,
   signal:['SIGKILL','SIGTERM','SIGABRT','SIGSEGV'].includes(error.signal)?error.signal:null};
  const stderr=typeof error.diagnostic==='string'?error.diagnostic:'';
  result.media.signatures=[['resource_unavailable',/Resource temporarily unavailable|pthread_create/i],['pipe_closed',/Broken pipe/i],
   ['invalid_media',/Invalid data found/i],['encoder_initialization',/Error (?:while opening|initializing) (?:encoder|output stream)/i],
   ['filter_configuration',/Failed to configure output pad|Error reinitializing filters/i]].filter(([,pattern])=>pattern.test(stderr)).map(([name])=>name);
 }
 return result;
}
