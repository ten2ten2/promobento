import {readFileSync, readdirSync, statfsSync} from 'node:fs';

const numeric = value => value === 'max' || value == null ? null : (/^\d+$/.test(value) ? Number(value) : null);
const readNumber = path => {
  try {return numeric(readFileSync(path, 'utf8').trim());} catch {return null;}
};
const readCounter = (path, name) => {
  try {return numeric(new RegExp('^' + name + ' (\\d+)$', 'm').exec(readFileSync(path, 'utf8'))?.[1]);}
  catch {return null;}
};
const disk = () => {
  try {
    // statfs reports the entire filesystem containing /jobs, not the size of
    // the /jobs directory. Keep the mount-wide scope explicit in telemetry.
    const {bsize, blocks, bfree, bavail} = statfsSync('/jobs');
    return {used: (blocks - bfree) * bsize, available: bavail * bsize};
  } catch {return {used: null, available: null};}
};
const fdCount = () => {try {return readdirSync('/proc/self/fd').length;} catch {return null;}};
const maxObserved = (previous, next) => next === null ? previous : Math.max(previous ?? 0, next);
const minObserved = (previous, next) => next === null ? previous : Math.min(previous ?? Infinity, next);
const delta = (start, end) => start === null || end === null ? null : Math.max(0, end - start);

/** cgroup counters cover Chromium + FFmpeg + controller, unlike process.memoryUsage(). */
export function monitorResources(intervalMs = 1000) {
  const diskBaseline = disk();
  const started = {
    cpu: readCounter('/sys/fs/cgroup/cpu.stat', 'usage_usec'),
    oom: readCounter('/sys/fs/cgroup/memory.events', 'oom'),
    oomKill: readCounter('/sys/fs/cgroup/memory.events', 'oom_kill'),
  };
  let controllerRssPeakBytes = null, cgroupMemorySamplePeakBytes = null;
  let filesystemUsedSamplePeakBytes = null, filesystemUsedIncreaseSamplePeakBytes = null;
  let filesystemAvailableSampleMinBytes = null, controllerFdSamplePeak = null;
  let stopped;
  const sample = () => {
    controllerRssPeakBytes = maxObserved(controllerRssPeakBytes, process.memoryUsage().rss);
    cgroupMemorySamplePeakBytes = maxObserved(cgroupMemorySamplePeakBytes, readNumber('/sys/fs/cgroup/memory.current'));
    const {used, available} = disk();
    filesystemUsedSamplePeakBytes = maxObserved(filesystemUsedSamplePeakBytes, used);
    filesystemUsedIncreaseSamplePeakBytes = maxObserved(filesystemUsedIncreaseSamplePeakBytes, delta(diskBaseline.used, used));
    filesystemAvailableSampleMinBytes = minObserved(filesystemAvailableSampleMinBytes, available);
    controllerFdSamplePeak = maxObserved(controllerFdSamplePeak, fdCount());
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  return {stop() {
    if (stopped) return stopped;
    clearInterval(timer);
    sample();
    stopped = {
      source: 'container_cgroup_v2_and_controller_samples', sampleIntervalMs: intervalMs,
      cgroupMemoryPeakBytes: readNumber('/sys/fs/cgroup/memory.peak'),
      cgroupMemoryLimitBytes: readNumber('/sys/fs/cgroup/memory.max'),
      cgroupMemorySamplePeakBytes, controllerRssSamplePeakBytes: controllerRssPeakBytes,
      cgroupOomDelta: delta(started.oom, readCounter('/sys/fs/cgroup/memory.events', 'oom')),
      cgroupOomKillDelta: delta(started.oomKill, readCounter('/sys/fs/cgroup/memory.events', 'oom_kill')),
      cgroupCpuUsageMicrosDelta: delta(started.cpu, readCounter('/sys/fs/cgroup/cpu.stat', 'usage_usec')),
      filesystemUsedSamplePeakBytes, filesystemUsedIncreaseSamplePeakBytes,
      filesystemAvailableSampleMinBytes, controllerFdSamplePeak,
    };
    return stopped;
  }};
}
