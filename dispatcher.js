import DownloadWorker from './download-worker.js';
import FFMPEGWorker from './ffmpeg-worker.js';
import ThumbnailWorker from './thumbnail-worker.js';

const defaultState = () => ({
  state: '',
  progress: 0,
  description: 'None',
});

class Dispatcher {
  constructor(cdnManager) {
    this.cdnManager = cdnManager;
    this.workQueue = [];
    this.completedQueue = [];
    this.currentTask = undefined;
    this.listeners = {};
    this.updateWorker = undefined;
    this.lastState = undefined;
    this.currentState = defaultState();
  }

  queue(type, extras, callbackStart, callbackEnd) {
    const uniqueID = this.cdnManager.getUniqueToken();
    const job = new Job(uniqueID, type, extras, callbackStart, callbackEnd);
    this.workQueue.push(job);

    this.dispatch();
    return uniqueID;
  }

  getQueue() {
    return this.completedQueue.concat(this.currentTask === undefined ? [] : [this.currentTask], this.workQueue.map(x => ({job: x})));
  }

  invokeUpdateProgressEvent(state, progress) {
    this.currentState.state = state;
    this.currentState.progress = progress;
    this.createUpdateWorker();
  }

  invokeUpdateJobEvent(job) {
    this.currentState.description = job;
    Object.values(this.listeners).forEach(x => x[1](job));
  }

  invokeIdle() {
    this.currentState = defaultState();
    if (this.updateWorker !== undefined) {
      clearInterval(this.updateWorker);
      this.updateWorker = undefined;
    }
    this.sendUpdate();
  }

  deleteJob(jobId) {
    if (this.currentTask !== undefined && this.currentTask.job.id === jobId) {
      this.currentTask.cancel();
      this.cdnManager.deregisterCDNID(jobId);
    } else {
      const idx1 = this.workQueue.findIndex(x => x.id === jobId);
      if (idx1 >= 0) {
        this.cdnManager.deregisterCDNID(jobId);
        this.workQueue.splice(idx1, 1);
      }
      const idx2 = this.completedQueue.findIndex(x => x.job.id === jobId);
      if (idx2 >= 0) {
        this.cdnManager.deregisterCDNID(jobId);
        this.cdnManager.deleteFile(jobId);
        this.completedQueue.splice(idx2, 1);
      }
    }
  }

  addListeners(key, handlers) {
    if (this.lastState !== undefined) {
      handlers[0](this.lastState.state, this.lastState.progress);
      handlers[1](this.lastState.description);
    }
    this.listeners[key] = handlers;
  }

  removeListener(key) {
    delete this.listeners[key];
  }

  createUpdateWorker() {
    if (this.updateWorker === undefined) {
      this.sendUpdate();
      this.updateWorker = setInterval(this.sendUpdate.bind(this), 1000);
    }
  }

  sendUpdate() {
    const state = defaultState();
    state.state = this.currentState.state;
    state.progress = this.currentState.progress;
    state.description = this.currentState.description;

    if (this.lastState === undefined || state.state !== this.lastState.state || state.progress !== this.lastState.progress) {
      Object.values(this.listeners).forEach(x => {
        x[0](state.state, state.progress);
      });
    }

    if (this.lastState === undefined || state.description !== this.lastState.description) {
      Object.values(this.listeners).forEach(x => {
        x[1](state.description);
      });
    }
    this.lastState = state;
  }

  dispatch() {
    if (!this.currentTask) {
      this.dequeueTask();
      this.worker();
    }
  }

  dequeueTask() {
    if (this.workQueue.length === 0) {
      this.currentTask = undefined;
      this.invokeIdle();
      return;
    }

    const job = this.workQueue.shift();
    this.currentTask = new Task(job, this.invokeUpdateProgressEvent.bind(this));
    this.invokeUpdateJobEvent(this.currentTask.job.getDescription());
  }

  async worker() {
    // Read Current Task

    if (this.currentTask === undefined) {
      return;
    }
    
    this.currentTask.job.callbackStart();
    const taskType = this.currentTask.job.type;
    const callback = this.currentTask.job.callbackEnd;
    console.log(`[JOB] Processing ${taskType}`);
    let cdnURL;

    if (taskType === JOB_TYPE_DOWNLOAD) {
      this.currentTask.setState('Downloading', 0);
      const dlJob = DownloadWorker.download(this.currentTask.job.extras.url);
      this.currentTask.cancellable = dlJob;
      let updater = () => {
        this.currentTask.setProgress(dlJob.getProgress());
      };
      let updateTimer = setInterval(updater, 500);

      let result;
      try {
        result = await (dlJob.getWaitable());
      } catch (err) {}
      this.currentTask.cancellable = undefined;

      clearInterval(updateTimer);
      if (result === undefined) {
        console.log('[JOB] Failed');
        this.dequeueTask();
        callback(undefined);

        this.worker();
        return;
      }

      this.currentTask.job.extras.metadata = result.metadata;

      this.currentTask.setState('Converting', 0);
      const format = this.currentTask.job.extras.format === 1 ? 'mp3' : 'm4a';
      const quality = format === 'mp3' ? 10 - this.currentTask.job.extras.quality : this.currentTask.job.extras.quality;
      const outname = `${this.currentTask.job.id}.${format}`;
      const convertJob = FFMPEGWorker.convert(result, `./cache/${outname}`, format, quality);
      this.currentTask.cancellable = convertJob;
      updater = () => {
        this.currentTask.setProgress(convertJob.getProgress());
      };
      updateTimer = setInterval(updater, 500);

      try {
        await convertJob.getWaitable();
      } catch(err) {}
      this.currentTask.cancellable = undefined;
      if (updateTimer !== undefined) {
        clearInterval(updateTimer);
      }
      if (convertJob.cancelled) {
        console.log('[JOB] Failed');
        
        this.dequeueTask();
        callback(undefined);

        this.worker();
        return;
      }

      cdnURL = this.cdnManager.registerFile(this.currentTask.job.id, outname);
      this.completedQueue.push({
        job: this.currentTask.job,
        result: {
          url: cdnURL,
          name: outname,
        }
      });
    } else if (taskType === JOB_TYPE_THUMBNAIL) {
      this.currentTask.setState('Adding Thumbnail', 0);
      const format = this.currentTask.job.extras.format === 1 ? 'mp3' : 'm4a';

      const outname = `${this.currentTask.job.id}.${format}`;
      const thumbnailJob = ThumbnailWorker.convert(this.currentTask.job.extras.data, `./cache/${outname}`, format, this.currentTask.job.extras.thumbnail);
      this.currentTask.cancellable = thumbnailJob;
      let updater = () => {
        this.currentTask.setProgress(thumbnailJob.getProgress());
      };
      let updateTimer = setInterval(updater, 500);

      try {
        await thumbnailJob.getWaitable();
      } catch(err) {}
      this.currentTask.cancellable = undefined;
      if (updateTimer !== undefined) {
        clearInterval(updateTimer);
      }
      if (thumbnailJob.cancelled) {
        console.log('[JOB] Failed');
        
        this.dequeueTask();
        callback(undefined);

        this.worker();
        return;
      }

      cdnURL = this.cdnManager.registerFile(this.currentTask.job.id, outname);
      this.completedQueue.push({
        job: this.currentTask.job,
        result: {
          url: cdnURL,
          name: outname,
        }
      });
    }
    
    this.dequeueTask();
    callback(cdnURL);

    this.worker();
  }
}

const JOB_TYPE_DOWNLOAD = 1;
const JOB_TYPE_THUMBNAIL = 2;

class Job {
  constructor(id, type, extras, callbackStart, callbackEnd) {
    this.id = id;
    this.type = type;
    this.extras = extras;
    this.callbackStart = callbackStart;
    this.callbackEnd = callbackEnd;
  }

  getDescription() {
    if (this.type === JOB_TYPE_DOWNLOAD) {
      if (this.extras.metadata) {
        return `[${this.extras.format === 1 ? 'MP3' : 'M4A'}, Quality: ${this.extras.quality}] ${this.extras.metadata.title}`;
      } else {
        return `[${this.extras.format === 1 ? 'MP3' : 'M4A'}, Quality: ${this.extras.quality}] ${this.extras.vid}`;
      }
    } else {
      return this.extras.inputFileName;
    }
  }
}

class Task {
  constructor(job, eventListener) {
    this.job = job;
    this.eventListener = eventListener;
    this.progress = 0;
    this.state = '';
    this.cancellable = undefined;
  }

  setProgress(newProg) {
    this.progress = newProg;
    this.invokeEvent();
  }

  incrementProgress(inc) {
    this.progress += inc;
    this.invokeEvent();
  }

  setState(state, optProg) {
    this.state = state;
    if (optProg !== undefined) {
      this.progress = optProg;
    }
    this.invokeEvent();
  }

  invokeEvent() {
    this.eventListener(this.state, this.progress);
  }

  cancel() {
    if (this.cancellable !== undefined) {
      this.cancellable.cancel();
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { Dispatcher as default, Job };