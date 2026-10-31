'use strict';
const {parentPort} = require('worker_threads');
const {parseLogFile} = require('./parse-log');

parentPort.on('message', async ({file}) => {
  try {
    parentPort.postMessage({file, rec: await parseLogFile(file)});
  } catch (err) {
    parentPort.postMessage({file, error: String(err && err.message || err)});
  }
});
