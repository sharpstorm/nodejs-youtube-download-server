'use strict';

import DownloadWorker from './download-worker.js';
import FFMPEGWorker from './ffmpeg-worker.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const dlJob = DownloadWorker.download('https://www.youtube.com/watch?v=LjEJc9coMCg');
(async () => {
  let result;
  try {
    result = await (dlJob.getWaitable());
  } catch (err) {}
  const convertJob = FFMPEGWorker.convert(result, 'testout.m4a', 'm4a');
  await convertJob.getWaitable();
  console.log('done');
})();
