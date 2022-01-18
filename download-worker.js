import fetch from 'node-fetch';
import ytdl from 'ytdl-core';
import streams from 'memory-streams';
import https from 'https';

const MEM_CACHE_LIMIT = 40 * 1024 * 1024;

export default class DownloadWorker {
  static download(url) {
    return new DownloadJob(url);
  }
}

class DownloadJob {

  constructor(url) {
    this.url = url;
    this.downloadThread = undefined;
    this.cancelled = false;
    this.cancelTimer = undefined;

    this.total = 0;
    this.downloaded = 0;
    this.startDownload();
  }

  startDownload() {
    this.downloadThread = (async () => {
      const info = await ytdl.getInfo(this.url);
      const formats = info.formats;
      const chosen = ytdl.chooseFormat(formats, {
        quality: 'highestaudio',
        filter: 'audioonly'
      });

      const size = chosen.contentLength;
      const codec = chosen.codec;
      const mime = chosen.mimeType;
      const sampleRate = chosen.audioSampleRate;
      const approxDurationMs = chosen.approxDurationMs;
      const downloadURL = chosen.url;

      if (size > MEM_CACHE_LIMIT) {
        throw new Error('[ABORT] File Size too Big');
      }

      this.total = size;

      console.log(`Fetching ${downloadURL}`);

      const httpsAgent = new https.Agent({
        keepAlive: true,
        maxSockets: 1
      });
      const controller = new AbortController();
      const cancelChecker = () => {
        if (this.cancelled) {
          clearInterval(this.cancelTimer);
          this.cancelTimer = undefined;
          controller.abort();
        }
      };
      this.cancelTimer = setInterval(cancelChecker, 100);

      let resp;
      try {
        resp = await fetch(downloadURL, {
          highWaterMark: 1024 * 1024,
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.93 Safari/537.36'
          },
          agent: httpsAgent,
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error('[ABORT] Job was cancelled');
        } else {
          throw new Error('[ABORT] Fetch Failed');
        }
      }
      
      if (!resp.ok) {
        throw new Error('[ABORT] Failed to download media');
      }

      console.log('[DEBUG] Recv OK Signal');
      const writer = new streams.WritableStream();
      this.downloaded = 0;
  
      console.log('downloading');
      try {
        for await (const chunk of resp.body) {
          this.downloaded += chunk.length;
          writer.write(chunk);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error('[ABORT] Job was cancelled');
        } else {
          throw new Error('[ABORT] Download Failed');
        }
      }
  
      clearInterval(this.cancelTimer);
      this.cancelTimer = undefined;

      const format = mime.includes(';') ? mime.split(';')[0].split('/')[1] : mime.split('/')[1];

      return {
        data: writer.toBuffer(),
        format,
        formatMetadata: {
          size,
          codec,
          mime,
          sampleRate,
        },
        metadata: {
          title: info.videoDetails.title,
          length: info.videoDetails.lengthSeconds,
          thumbnails: info.videoDetails.thumbnails,
        }
      };
    })();
  }

  getWaitable() {
    return this.downloadThread;
  }

  getProgress() {
    return (this.downloaded / this.total) * 100;
  }

  cancel() {
    this.cancelled = true;
  }

  cleanup() {
    if (this.cancelTimer) {
      clearInterval(this.cancelTimer);
    }
  }
}