// Logging and password storage of the sample application under review.
'use strict'

const crypto = require('node:crypto')
const config = require('./config')

function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex')
}

function auditLogin(user) {
  console.log(`login ${user.email} ssn=${user.ssn} card=${user.cardNumber} password=${user.password}`)
}

function ship(payload) {
  return fetch(config.reportingEndpoint, { method: 'POST', body: JSON.stringify(payload) })
}

module.exports = { hashPassword, auditLogin, ship }
