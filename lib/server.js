'use strict'

module.exports = {
  serve
}

const requireOnce = require('./require-once.js')
let web, util, fs, nsync, path
const BluetoothSerialPort = require('bluetooth-serial-port');
const rfcomm = new BluetoothSerialPort.BluetoothSerialPort();

function serve(options, callback) {
  web = requireOnce('./web.js')
  util = requireOnce('./util.js')
  fs = requireOnce('fs')
  nsync = requireOnce('neo-async')
  path = requireOnce('path')

  rfcomm.listPairedDevices(function (list) {
    console.log(JSON.stringify(list, null, 2));
  });

  let btSerial = rfcomm;

  btSerial.on('found', function(address, name) {
    console.log(address);
    btSerial.connect(address, 12, function() {
      console.log('connected');

      console.log("writing", "my data");
      btSerial.write(Buffer.from('my data', 'utf-8'), function(err, bytesWritten) {
        if (err) console.log(err);
      });

      btSerial.on('data', function(buffer) {
        console.log(buffer.toString('utf-8'));
      });
    }, function () {
      console.log('cannot connect');
    });
    // close the connection when you're ready
    btSerial.close();
  });
  
  btSerial.inquire();


  let port
  if (util.isRealObject(options) && 'port' in options) {
    port = options.port
  } else {
    port = process.env.PORT || '3000'
  }

  const processCwd = process.cwd()
  const WEBCONFIG = {
    'routes': [{
      'route': '/',
      'method': 'all',
      'chain': path.join(__dirname, 'chains/server.route.js')
    }],
    'staticPath': null,
    'faviconPath': null,
    'viewPath': null,
    'startupHook': path.join(__dirname, 'chains/server.startupHook.js'),
    'beforeRequestHook': path.join(__dirname, 'chains/server.beforeRequestHook.js'),
    'afterRequestHook': path.join(__dirname, 'chains/server.afterRequestHook.js'),
    'localStartupHook': false,
    'localBeforeRequestHook': false,
    'localAfterRequestHook': false
  }

  nsync.parallel([
    (next) => {
      fs.access(path.join(processCwd, 'startup.chiml'), fs.constants.R_OK, (error) => {
        if (!error) {
          WEBCONFIG.localStartupHook = 'startup.chiml'
          console.warn('Startup hook found')
        }
        next()
      })
    },
    (next) => {
      fs.access(path.join(processCwd, 'beforeRequest.chiml'), fs.constants.R_OK, (error) => {
        if (!error) {
          WEBCONFIG.localBeforeRequestHook = 'beforeRequest.chiml'
          console.warn('BeforeRequest hook found')
        }
        next()
      })
    },
    (next) => {
      fs.access(path.join(processCwd, 'afterRequest.chiml'), fs.constants.R_OK, (error) => {
        if (!error) {
          WEBCONFIG.localAfterRequestHook = 'afterRequest.chiml'
          console.warn('AfterRequest hook found')
        }
        next()
      })
    }
  ], (error) => {
    if (error) {
      console.error(error)
    }
    createServer(WEBCONFIG, port, callback)
  })

  function createServer(WEBCONFIG, port, callback) {
    try {
      // create web app
      const app = web.createApp(WEBCONFIG)
      const server = web.createServer(app)
      // start the web app
      server.listen(port, function () {
        console.log('Chimera service started at port ' + port)
        const result = { 'server': server, 'app': app, 'port': port }
        callback(null, result)
      })
    } catch (error) {
      callback(error, null)
    }
  }
}
