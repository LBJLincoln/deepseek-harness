// Entry point of the sample application under review.
'use strict'

const express = require('express')
const session = require('express-session')
const config = require('./src/config')
const admin = require('./src/admin')

const app = express()

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Credentials', 'true')
  next()
})

app.use(session({
  secret: config.sessionSecret,
  cookie: { httpOnly: false, secure: false, maxAge: 86400000 },
  resave: true,
  saveUninitialized: true,
}))

app.use((error, req, res, next) => {
  res.status(500).send(`<pre>${error.stack}</pre>`)
})

admin.mount(app, require('./src/db'))

app.listen(config.port)
