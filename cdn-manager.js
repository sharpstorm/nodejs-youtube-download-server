import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const config_cachePath = './cache';

export default class CDNManager {
  constructor() {
    this.cdnPath = path.resolve(config_cachePath);
    this.tokenSet = new Set();
    this.cdnFiles = {};
  }

  init() {
    if (fs.existsSync(this.cdnPath)) {
      const files = fs.readdirSync(this.cdnPath);
      for (const file of files) {
        fs.unlinkSync(path.join(this.cdnPath, file));
      }
    } else {
      fs.mkdirSync(this.cdnPath);
    }
    
    return this;
  }

  getUniqueToken() {
    const generated = randomUUID();
    if (this.tokenSet.has(generated)) {
      return this.getUniqueToken();
    }
    this.tokenSet.add(generated);
    return generated;
  }

  registerFile(token, fileName) {
    this.cdnFiles[token] = {
      fileName,
      verifyToken: randomUUID(),
    };

    return `/cdn/${token}/${this.cdnFiles[token].verifyToken}/${fileName}`;
  }

  deregisterCDNID(id) {
    this.tokenSet.delete(id);
  }

  deleteFile(token) {
    delete this.cdnFiles[token];
  }

  route(cdnId, verifyToken) {
    if (!(cdnId in this.cdnFiles)) {
      return undefined;
    }
    const entry = this.cdnFiles[cdnId];
    if (verifyToken !== entry.verifyToken) {
      return undefined;
    }

    return path.join(this.cdnPath, entry.fileName);
  }
}
