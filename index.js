#!/usr/bin/env node

"use strict"

require('./helper')
let fs = require('fs').promise
let express = require('express')
let morgan = require('morgan')
let trycatch = require('trycatch')
let wrap = require('co-express')
let bodyParser = require('simple-bodyparser')
let path = require('path')
let rimraf = require('rimraf').promise
let archiver = require('archiver')
let yargs = require('yargs').argv
let tcp = require('json-over-tcp')
let jsonSocket = require('json-socket')
var net = require('net')
let mime = require('mime-types')
let chokidar = require('chokidar')



const NODE_ENV = process.env.NODE_ENV
const PORT = process.env.PORT || 9000
const ROOT_DIR = yargs.dir ? yargs.dir : path.resolve(process.cwd())
console.log(ROOT_DIR)

function* main() {
    let app = express()
    app.use(morgan('dev'))
    app.use((req, res, next) => {
        trycatch(next, e => {
            console.log(e.stack)
            res.writeHead(500)
            res.end(e.stack)
        })
    })
    console.log('...')

    console.log('Starting HTTP server ...')

    app.get('*', wrap(read))
    app.put('*', wrap(create))
    app.post('*', bodyParser(), wrap(update))
    app.delete('*', wrap(remove))
    app.head('*', wrap(head))
    app.listen(PORT)
    console.log('LISTENING FOR HTTP requests @ http://127.0.0.1:' + PORT)
    console.log('...')


    console.log('Starting TCP server now...')
    let server = net.createServer();
    server.listen(PORT + 1);
    console.log('LISTENING for TCP requests  @ 127.0.0.1:' + (PORT + 1))
    console.log('...')
    server.on('connection', (socket)=> {
        console.log('Got a request on server')
        socket = new jsonSocket(socket);
        console.log('Adding watchers')

        let watcher = chokidar.watch('.', {
            ignored: /[\/\\]\./,
            persistent: true
        })
        watcher.on('add', (path) => {
            console.log("file added")
            let data = {
                action: 'create',
                path: path,
                type: 'file',
                contents: null,
                updated: new Date().getTime()
            }
            socket.sendMessage(data);
        })

        watcher.on('change', (path) => {
            console.log("file changed")

            let data = {
                action: 'update',
                path: path,
                type: 'file',
                contents: null,
                updated: new Date().getTime()
            }
            socket.sendMessage(data);
        })

        watcher.on('unlink', (path) => {
            console.log("file deleted")

            let data = {
                action: 'remove',
                path: path,
                type: 'file',
                contents: null,
                updated: new Date().getTime()
            }
            socket.sendMessage(data);
        })

        watcher.on('addDir', (path) => {
            console.log("directory added")

            let data = {
                action: 'create',
                path: path,
                type: 'dir',
                contents: null,
                updated: new Date().getTime()
            }
            socket.sendMessage(data);
        })

        watcher.on('unlinkDir', (path) => {
            console.log("directory deleted")
            let data = {
                action: 'remove',
                path: path,
                type: 'dir',
                contents: null,
                updated: new Date().getTime()
            }
            socket.sendMessage(data);
        })
        onConnectionListener(socket)
    });
}


function* read(req, res) {
    console.log("read")
    let filePath = path.join(ROOT_DIR, req.url)

    if (filePath.slice(-1) === '/') {
        let fileNames = yield fs.readdir(filePath)
        yield sendHeaders(req, res)
        console.log(req.headers.accept)
        if (req.headers.accept === 'application/x-gtar') {
            let archive = archiver('zip')
            archive.pipe(res);
            archive.bulk([
                { expand: true, cwd: 'source', src: ['**'], dest: 'source'}
            ])
            archive.finalize()
        } else {
            res.end(JSON.stringify(fileNames))
        }
    } else {
        fs.access(filePath, fs.F_OK, function (err) {
            if (err) {
                // Do something
                res.send(405, 'Method Not Allowed')
                res.end
            }
        })
        let data = yield fs.readFile(filePath)
        yield sendHeaders(req, res)
        res.end(data)
    }
}

function* create(req, res) {
    console.log("create")
    let filePath = path.join(ROOT_DIR, req.url)
    try {
        let stats = yield fs.stat(filePath)
        res.send(405, 'Method Not Allowed')
        res.end
    } catch (err) {
        console.log(filePath)
        if (err && err.code !== 'ENOTDIR' && filePath.slice(-1) === '/') {
            try {
                yield fs.mkdir(filePath);
                res.end()
            } catch (e) {
                console.log(e.stack)
            }
        } else {
            let data = yield fs.open(filePath, "wx")
            res.end()
        }
    }
}

function* update(req, res) {
    console.log("update")
    let filePath = path.join(ROOT_DIR, req.url)
    if (filePath.slice(-1) === '/') {
        res.send(405, 'Method Not Allowed')
        res.end
    }
    fs.access(filePath, fs.F_OK, function (err) {
        if (err) {
            res.send(405, 'Method Not Allowed')
            res.end
        }
    })
    yield fs.truncate(filePath)
    let data = yield fs.writeFile(filePath, req.body)
    console.log(req.body)
    res.end()
}

function* remove(req, res) {
    console.log("delete")
    let filePath = path.join(ROOT_DIR, req.url)
    if (filePath.slice(-1) === '/') {
        console.log(filePath)
        yield rimraf(filePath)
        res.end()
    }
    else {
        fs.access(filePath, fs.F_OK, function (err) {
            if (err) {
                res.send(405, 'Method Not Allowed')
                res.end
            }
        })
        let data = yield fs.unlink(filePath)
        res.end()
    }
}

function* head(req, res) {
    console.log("head")
    sendHeaders(req, res)
}

function* sendHeaders(req, res) {
    console.log("setting headers")
    let filePath = path.join(ROOT_DIR, req.url)
    if (filePath.slice(-1) === '/') {
        let fileNames = yield fs.readdir(filePath)
        let data = JSON.stringify(fileNames)
        res.setHeader('Content-Length', data.length)

    } else {
        let data = yield fs.readFile(filePath)
        res.setHeader('Content-Length', data.length)
    }
    let contentType = mime.contentType(path.extname(req.filePath))
    res.setHeader('Content-Type', contentType)

}

function* onConnectionListener(socket) {
    console.log("new tcp connection received")
    socket.on('message', function (body) {
        console.log("new tcp message received")
        let msgFilePath = body.filePath
        let fileType = body.type
        let event = body.event
        let filePath = path.resolve(path.join(ROOT_DIR, body.filePath))
        let stat = fs.stat(filePath)
        console.log(filePath)
        if (fileType === 'dir') {
            if (event === 'delete') {
                fs.stat(filePath)
                    .then(stat => {
                        rimraf(filePath)
                    }).catch();
                socket.sendMessage({
                    action: 'delete',
                    path: msgFilePath,
                    type: 'dir',
                    contents: null,
                    updated: new Date().getTime()
                })
            } else if (event === 'create') {
                mkdirp(filePath)
                socket.sendMessage({
                    action: 'create',
                    path: msgFilePath,
                    type: 'dir',
                    contents: null,
                    updated: new Date().getTime()
                })
            }
        } else {
            if (event === 'delete') {
                fs.stat(filePath)
                    .then(stat => {
                        fs.unlink(filePath);
                    }).catch();
                socket.sendMessage({
                    action: 'delete',
                    path: msgFilePath,
                    type: 'file',
                    contents: null,
                    updated: new Date().getTime()
                })
            } else if (event === 'create') {
                console.log(filePath)
                fs.createWriteStream(filePath)
                socket.sendMessage({
                    action: 'create',
                    path: msgFilePath,
                    type: 'file',
                    contents: null,
                    updated: new Date().getTime()
                })
            }
        }
    })

}

module.exports = main
