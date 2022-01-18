'use strict';

import DownloadWorker from './download-worker.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const dlJob = DownloadWorker.download('https://www.youtube.com/watch?v=LjEJc9coMCg');
setTimeout(() => {dlJob.cancel();}, 5000);
(async () => {
  try {
    await (dlJob.getWaitable());
  } catch (err) {}
  console.log('Cancelled');
  await sleep(1000);
})();
