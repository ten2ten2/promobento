import { createRequestHandler } from 'react-router';
import * as serverBuild from 'virtual:react-router/server-build';
import { createWebWorker } from './worker.ts';

export default createWebWorker(createRequestHandler(serverBuild, 'production'));
