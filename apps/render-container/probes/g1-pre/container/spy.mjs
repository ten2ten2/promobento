// Same-uid spy, spawned by the controller (uid 10001) with an empty environment.
// Shows what any process sharing the controller's uid could read.
import {readFileSync, openSync, readSync, closeSync} from 'node:fs';

const [pid, needlesJson] = process.argv.slice(2);
const needles = JSON.parse(needlesJson);
const found = text => Object.entries(needles).filter(([, v]) => v && text.includes(v)).map(([k]) => k);
let environ, mem;
try { environ = found(readFileSync(`/proc/${pid}/environ`, 'utf8')); } catch (error) { environ = {error: error.code}; }
try {
  const line = readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n').find(l => / rw-p /.test(l));
  const fd = openSync(`/proc/${pid}/mem`, 'r');
  readSync(fd, Buffer.alloc(16), 0, 16, parseInt(line.split('-')[0], 16));
  closeSync(fd);
  mem = 'readable';
} catch (error) { mem = {error: error.code ?? String(error.message)}; }
process.stdout.write(JSON.stringify({spyUid: process.getuid(), targetEnviron: environ, targetMem: mem}));
