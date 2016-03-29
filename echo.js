#!/usr/bin/env node

require('./helper')
let fs = require('fs').promise

function* echo() {
    // Use 'yield' in here
    // Your implementation here
    console.log(yield fs.readFile(__filename, console.log))
}

module.exports = echo
