import { initiateWebSocketMux, encodeObject, decodeObject } from 'omnistreams';
import { initiateWebSocketPeer } from 'omni-rpc';
import { FileReadProducer } from 'omnistreams-filereader';


class Hoster {

  constructor({ proxyAddress, port, secure, chunkSize, openRangedChunkSize }, readyCallback) {

    this._readyCallback = readyCallback;
    this._files = {};

    // Open ranged requests are sometimes terminated early, after the receiver
    // gets what they're looking for, so chunkSize is smaller by default.
    this._chunkSize = chunkSize ? chunkSize : 256*1024; //*1024;
    this._openRangedChunkSize = openRangedChunkSize ? openRangedChunkSize : 64*1024;

    if (this.isDefaultPort(port)) {
      this._portStr = "";
    }
    else {
      this._portStr = ':' + port;
    }

    initiateWebSocketMux({ address: proxyAddress, port, secure })
    .then((mux) => {

      this._mux = mux;

      mux.onControlMessage((rawMessage) => {
        const message = decodeObject(rawMessage)
        this.onMessage(message)
      });

      // Send a keep-alive every 30 seconds
      setInterval(() => {
        mux.sendControlMessage(encodeObject({
          type: 'keep-alive',
        }))
      }, 30000)
    });
  }

  onMessage(message) {

    switch(message.type) {
      case 'complete-handshake':
        this._id = message.id;
        this._readyCallback(this);
         
        break;
      case 'GET':
        //console.log(message)
        if (message.type === 'GET') {
          if (this._files[message.url] !== undefined) {

            const fullFile = this._files[message.url];

            let file = fullFile;

            //console.log(`read file: ${message.url}`);

            let chunkSize = this._chunkSize;

            if (message.range) {

              //console.log(message.range, file.size);
              if (message.range.end !== undefined) {
                file = file.slice(message.range.start, message.range.end);
              }
              else {
                file = file.slice(message.range.start);
                
                chunkSize = this._openRangedChunkSize;
              }
            }

            //const fileStream = fileReaderStream(file);
            const streamSettings = {
              id: message.requestId,
              size: fullFile.size,
              range: message.range,
            };

            const fileStream = new FileReadProducer(file, { chunkSize })
            fileStream.id = streamSettings.id
            const sendStream = this._mux.createConduit(encodeObject(streamSettings));

            fileStream.pipe(sendStream)

            fileStream.onTermination(() => {
            })
          }
          else {
            //console.log(`File ${message.url} not found`);
            this._mux.sendControlMessage(encodeObject({
              type: 'error',
              code: 404,
              message: "File not found",
              requestId: message.requestId,
            }))
          }
        }
        break;
      default:
        throw "Invalid message type: " + message.type;
        break;
    }
  }

  hostFile({ path, file }) {
    this._files[path] = file;
  }

  getHostedPath(url) {
    if (this._files[url]) {
      return '/' + this._id + url;
    }
    else {
      throw "No file hosted at: " + url;
    }
  }

  getPortStr() {
    return this._portStr;
  }

  isDefaultPort(port) {
    if ((this._wsProtoStr === 'ws:' && port === 80) ||
        (this._wsProtoStr === 'wss:' && port === 443)) {
      return true;
    }
    else {
      return false;
    }
  }
}

function createHoster(options) {
  return new Promise((resolve, reject) => {
    new Hoster(options, function ready(hoster) {
      resolve(hoster);
    });
  });
}

export { createHoster };
