import {canonical, compareUtf16, parseCanonicalJson} from '@promobento/contracts/canonical';
import {assertNativeProject, nativeProjectHash} from '@promobento/contracts/native-project';
import type {VideoFrameManifest} from '@promobento/contracts/video-frames';

const input: unknown = parseCanonicalJson(new TextEncoder().encode('{}'));
const project = assertNativeProject(input);
const encoded: string = canonical(project);
const hash: Promise<string> = nativeProjectHash(project);
const order: -1 | 0 | 1 = compareUtf16('a', 'b');
const timingKey: string | undefined = project.timingEvidenceRef?.key;
const samplingRule: VideoFrameManifest['samplingRule'] = 'off-boundary-v2';
void [encoded, hash, order, timingKey, samplingRule];

// @ts-expect-error Incoming JSON must be text or bytes.
parseCanonicalJson({});
