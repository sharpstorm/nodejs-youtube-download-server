import { spawn } from 'child_process';
import fs from 'fs';

export default class ThumbnailWorker {
  static convert(input, output, format, thumbnail) {
    return new ThumbnailJob(input, output, format, thumbnail);
  }
}

const durationRegex = /Duration: (\w+):(\w+):(\w+.\w+)/gi;
const timeRegex = /time=(\w+):(\w+):(\w+.\w+)/gi;

class ThumbnailJob {
  constructor(input, output, format, thumbnail) {
    this.input = input;
    this.output = output;
    this.format = format;
    this.thumbnail = thumbnail;
    this.cancelled = false;
    this.progress = 0;
    this.duration = 0;

    this.run();
  }

  run() {
    let args = [];
    let isPipe = false;

    if (this.input.data) {
      args = ['-f', this.input.format, '-i', 'pipe:'];
      isPipe = true;
    } else {
      args = ['-i', this.input];
    }

    if (this.format === 'mp3') {
      args = args.concat(['-i', this.thumbnail, '-map', '0:0', '-map', '1:0', '-c', 'copy', '-id3v2_version', '3', '-metadata:s:v', 'title="Album cover"', '-metadata:s:v', 'comment="Cover (front)"', this.output]);
    } else if (this.format === 'm4a') {
      args = args.concat(['-i', this.thumbnail, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:0', 'attached_pic', this.output]);
    } else {
      throw new Error('Invalid Format');
    }

    if (fs.existsSync(this.output)) {
      fs.unlinkSync(this.output);
    }

    this.subprocess = spawn('ffmpeg', args);

    this.subprocess.stdout.on('data', (data) => {
      const chunk = data.toString('utf8');
      this.matchTime(chunk);
      console.log(chunk);
    });

    this.subprocess.stderr.on('data', (data) => {
      const chunk = data.toString('utf8');
      this.matchTime(chunk);
      console.error(chunk);
    });

    this.promise = new Promise((resolve) => {
      this.subprocess.stdout.on('close', () => {
        console.log('Completed');
        clearInterval(this.cancelTimer);
        this.cancelTimer = undefined;
        if (!this.subprocess.killed) {
          this.subprocess.kill();
        }
        if (fs.existsSync(this.input)) {
          fs.unlinkSync(this.input);
        }
        if (fs.existsSync(this.thumbnail)) {
          fs.unlinkSync(this.thumbnail);
        }
        resolve();
      });
    });

    const cancelChecker = () => {
      if (this.cancelled) {
        clearInterval(this.cancelTimer);
        this.cancelTimer = undefined;
        this.subprocess.stdin.end();
      }
    };
    this.cancelTimer = setInterval(cancelChecker, 100);

    let position = 0;
    const writeData = () => {
      while (position < this.input.data.length && !this.cancelled) {
        const len = Math.min(this.input.data.length - position, 65536);
        const res = this.subprocess.stdin.write(this.input.data.subarray(position, position + len));
        position += len;

        if (!res) {
          this.subprocess.stdin.once('drain', () => {
            writeData();
          });
          return;
        }
      }
      if (!this.cancelled) {
        this.subprocess.stdin.end();
      }
    };

    if (isPipe) {
      try {
        writeData();
      } catch(err) {}
    }
  }

  matchTime(chunk) {
    if (chunk.match(durationRegex)) {
      const parts = durationRegex.exec(chunk);
      const hours = parseInt(parts[1]);
      const mins = parseInt(parts[2]);
      const secs = parseFloat(parts[3]);

      this.duration = secs + mins * 60 + hours * 60 * 60;
    }
    if (chunk.match(timeRegex)) {
      const parts = timeRegex.exec(chunk);
      const hours = parseInt(parts[1]);
      const mins = parseInt(parts[2]);
      const secs = parseFloat(parts[3]);

      this.progress = secs + mins * 60 + hours * 60 * 60;
    }
  }

  getWaitable() {
    return this.promise;
  }

  getProgress() {
    if (this.duration === undefined || this.duration === 0) {
      return 0;
    }
    return (this.progress / this.duration) * 100;
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
