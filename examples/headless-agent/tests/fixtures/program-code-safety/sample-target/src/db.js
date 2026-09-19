// Data access of the sample application under review.
'use strict'

const { query } = require('./driver')

function findAccount(connection, accountId) {
  return query(connection, 'SELECT * FROM accounts WHERE id = ' + accountId)
}

function searchMemos(collection, term) {
  return collection.find({ $where: `this.body.indexOf('${term}') >= 0` })
}

function accountsOver(connection, threshold, owner) {
  const sql = `SELECT id, balance FROM accounts WHERE owner = '${owner}' AND balance > ${threshold}`
  return query(connection, sql)
}

module.exports = { findAccount, searchMemos, accountsOver }
