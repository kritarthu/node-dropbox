#!/usr/bin/env node

"use strict"

require('./helper')
let fs = require('fs')
let path = require('path')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let net = require('net')
let JsonSocket = require('json-socket')
let request = require("request")
let AdmZip = require('adm-zip')


let argv = require('yargs')
    .default('dir', process.cwd())
    .default('event', 'create')
    .default('file', '')
    .default('port', '9001')
    .argv

const PORT = argv.port
const ROOT_DIR = path.resolve(argv.dir)

function* main() {
    let socket = new JsonSocket(new net.Socket());
    socket.connect(PORT, '127.0.0.1');
    socket.on('connect', function () {
        let options = {
            uri: 'http://127.0.0.1:9000/',
            headers: {'Accept': 'application/x-gtar'}
        }
        let req = request(options);
        console.log('Downloading the initial zip...')
        req.pipe(fs.createWriteStream('bootstrap.zip'))
        req.on('end', function() {
            console.log('Extracting the initial zip...')
            let zip = new AdmZip("bootstrap.zip")
            zip.extractAllTo(ROOT_DIR, true);
        });

        socket.on('message', function (message) {
            console.log('Message received...')
            console.log(message)
            let msgPath = message.path
            let type = message.type
            let action = message.event
            let content = message.contents
            let filePath = path.resolve(path.join(ROOT_DIR, msgPath))
            if (type === 'dir') {
                if (action === 'delete') {
                    fs.stat(filePath)
                        .then(stat => {
                            rimraf(filePath)
                        }).catch();
                } else if (action === 'create') {
                    mkdirp(filePath);
                }
            } else {
                if (action === 'delete') {
                    fs.stat(filePath)
                        .then(stat => {
                            fs.unlink(filePath);
                        }).catch();
                } else if (action === 'create') {
                    let dir = path.dirname(filePath);
                    mkdirp(dir);
                    content.pipe(fs.createWriteStream(filePath))
                }
            }
        })

    })
}

module.exports = main
