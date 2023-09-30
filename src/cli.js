#!/usr/bin/env node

if (typeof __OXIDE__ !== 'undefined') {
  module.exports = require('./oxide/cli')
} else {
  module.exports = require('./cli/index')
}
