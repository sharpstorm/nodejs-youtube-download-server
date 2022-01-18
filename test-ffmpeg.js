'use strict';

import fs from 'fs';
import path from 'path';
import FFMPEGWorker from './ffmpeg-worker.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('This requires a MP3 file to be present at ./test.mp3')
const memFile = fs.readFileSync(path.resolve('./test.mp3'));
const dlJob = FFMPEGWorker.convert({format: 'mp3', data: memFile}, 'testout.m4a', 'm4a');
setTimeout(() => dlJob.cancel(), 5000);
(async () => {
  await dlJob.getWaitable();
  console.log(dlJob.getProgress());
  await sleep(1000);
})();
