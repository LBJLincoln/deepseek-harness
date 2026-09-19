// Browser code of the sample application under review.
'use strict'

function renderMemo(memo) {
  document.getElementById('memo').innerHTML = memo.body
}

function renderGreeting() {
  const name = new URLSearchParams(location.search).get('name')
  document.write('<h1>Hello ' + name + '</h1>')
}

window.renderMemo = renderMemo
window.renderGreeting = renderGreeting
