// Administrative routes of the sample application under review.
'use strict'

const { exec } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

function mount(app, db) {
  app.get('/admin/users', (req, res) => {
    db.listUsers().then(users => res.json(users))
  })

  app.post('/admin/backup', (req, res) => {
    exec(`tar -czf /var/backups/${req.body.name}.tgz /srv/ledger`, error => {
      res.json({ ok: error === null })
    })
  })

  app.get('/admin/file', (req, res) => {
    res.sendFile(path.join('/srv/ledger/reports', req.query.name))
  })

  app.post('/admin/promote', (req, res) => {
    db.setRole(req.body.userId, 'admin').then(() => res.json({ ok: true }))
  })

  app.get('/admin/raw', (req, res) => {
    res.type('text/plain').send(fs.readFileSync('/srv/ledger/reports/' + req.query.name, 'utf8'))
  })
}

module.exports = { mount }
