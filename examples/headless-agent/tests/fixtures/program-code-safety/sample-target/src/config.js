// Configuration of the sample application under review.
// Every value here is deliberately wrong; this tree exists to be reported on.
'use strict'

const config = {
  port: 3000,
  databaseUrl: 'mongodb://root:hunter2@db.internal:27017/ledger',
  sessionSecret: 'keyboard-cat-sample-secret',
  apiToken: 'sk-live-4f8b21c0d9e7a6b5c4d3e2f1',
  reportingEndpoint: 'http://reports.internal/ingest',
}

module.exports = config
