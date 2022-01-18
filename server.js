'use strict';

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';

import Dispatcher from './dispatcher.js';
import ConnectionHandlerFactory from './conn-handler-factory.js';
import CDNManager from './cdn-manager.js';

const PORT = 8181;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const cdnManager = new CDNManager().init();
const dispatcher = new Dispatcher(cdnManager);
const handlerFactory = new ConnectionHandlerFactory(dispatcher, io, cdnManager);

// Clear upload cache
if (fs.existsSync('./cache-uploads')) {
  const files = fs.readdirSync('./cache-uploads');
  for (const file of files) {
    fs.unlinkSync(path.join('./cache-uploads', file));
  }
} else {
  fs.mkdirSync('./cache-uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './cache-uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix);
  }
});
const upload = multer({storage: storage});

app.get('/', (request, response) => {
  response.sendFile(path.join(path.resolve(), 'client/app.html'));
});

app.get('/Barlow-Light.ttf', (request, response) => {
  response.sendFile(path.join(path.resolve(), 'client/Barlow-Light.ttf'));
});

app.get('/Barlow-Regular.ttf', (request, response) => {
  response.sendFile(path.join(path.resolve(), 'client/Barlow-Regular.ttf'));
});

app.get('/download.svg', (request, response) => {
  response.sendFile(path.join(path.resolve(), 'client/download.svg'));
});

app.get('/cdn/:cdnId/:verifyToken/*', (request, response) => {
  const cdnId = request.params.cdnId;
  const verifyToken = request.params.verifyToken;

  const file = cdnManager.route(cdnId, verifyToken);
  if (file === undefined) {
    response.status(404).send('Not Found');
  } else {
    response.sendFile(file);
  }
});

app.post('/submit-job', upload.fields([{name: 'data'}, {name: 'thumbnail'}]), (request, response) => {
  const src = request.files['data'];
  const thumb = request.files['thumbnail'];
  const format = request.body.format;

  if (src === undefined || thumb === undefined || format === undefined) {
    response.status(400).send('Bad Request');
    return;
  }
  if (parseInt(format) === NaN) {
    response.status(400).send('Bad Request');
    return;
  }

  const extras = {
    format: parseInt(format),
    data: src[0].path,
    thumbnail: thumb[0].path,
    inputFileName: src[0].originalName,
  }

  dispatcher.queue(2, extras, 
    () => handlerFactory.broadcastUpdateQueue(), 
    (url) => {
      handlerFactory.broadcastUpdateQueue();
    }
  );
  handlerFactory.broadcastUpdateQueue();
  response.status(200).send('OK');
});

io.on('connection', (conn) => {
  const client = handlerFactory.create(conn);
});

httpServer.listen(PORT, () => {
  console.log('Server Running');
});
