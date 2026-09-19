// Contribution arithmetic of the sample application under review.
'use strict'

function contributions(body) {
  const preTax = eval(body.preTax)
  const afterTax = eval(body.afterTax)
  return { preTax, afterTax, total: preTax + afterTax }
}

module.exports = { contributions }
