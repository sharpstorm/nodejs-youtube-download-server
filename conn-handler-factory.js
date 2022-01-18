export default class ConnectionHandlerFactory {
  constructor(dispatcher, io) {
    this.dispatcher = dispatcher;
    this.io = io;
  }

  create(conn) {
    return new ConnectionHandler(this.adapter(), conn).init(this.jsonQueue(this.dispatcher.getQueue()));
  }

  adapter() {
    return {
      getDispatcher: () => this.dispatcher,
      broadcastUpdateQueue: this.broadcastUpdateQueue.bind(this),
    };
  }

  jsonQueue(queue) {
    return queue.map(x => ({
      id: x.job.id,
      type: x.job.type,
      data: x.job.getDescription(),
      state: x.result !== undefined ? 3 : (x.progress !== undefined ? 2 : 1),
      result: x.result,
    }));
  }

  broadcastUpdateQueue() {
    const queue = this.jsonQueue(this.dispatcher.getQueue());
    this.io.emit('update-queue', queue);
  }
}

class ConnectionHandler {
  constructor(adapter, conn) {
    this.conn = conn;
    this.adapter = adapter;

    this.attachEvents();
    console.log(`[Connection] ${conn.id}`);
  }

  init(sendableQueue) {
    this.conn.emit('update-queue', sendableQueue);

    return this;
  }

  attachEvents() {
    this.conn.on('disconnect', (reason) => {
      console.log(reason);
      this.adapter.getDispatcher().removeListener(this.conn.id);
    });

    this.conn.on('submit-job', (type, data) => {
      // Some preprocessing
      if (type === 1) { // Download Job
        if (data.vid === undefined || data.format === undefined || data.quality === undefined) {
          this.conn.emit('submit-job-reject');
          return;
        }
        if (parseInt(data.format) === NaN || parseFloat(data.quality) === NaN) {
          this.conn.emit('submit-job-reject');
          return;
        }
        data.format = parseInt(data.format);
        data.quality = parseFloat(data.quality);
        data.url = `https://youtube.com/watch?v=${data.vid}`;
      } else if (type === 2) { // Thumbnail job
        this.conn.emit('submit-job-reject');
        return;
        if (data.data === undefined || data.format === undefined || data.thumbnail === undefined) {
          this.conn.emit('submit-job-reject');
          return;
        }
        if (parseInt(data.format) === NaN) {
          this.conn.emit('submit-job-reject');
          return;
        }
        data.format = parseInt(data.format);
      }
      
      this.adapter.getDispatcher().queue(type, data, 
        () => this.adapter.broadcastUpdateQueue(), 
        (url) => {
          this.adapter.broadcastUpdateQueue();
        }
      );
      this.conn.emit('submit-job-success');
      this.adapter.broadcastUpdateQueue();
    });

    this.conn.on('delete-job', (jobId) => {
      this.adapter.getDispatcher().deleteJob(jobId);
      this.adapter.broadcastUpdateQueue();
    })

    this.adapter.getDispatcher().addListeners(this.conn.id, [
      (state, progress) => { this.conn.emit('update-current-progress', state, progress); },
      (job) => { this.conn.emit('update-current-job', job); },
    ]);
  }
}
