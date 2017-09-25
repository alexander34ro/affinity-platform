#! /usr/bin/env node
'use strict';

let chimera = require('../index.js')

if(require.main === module){
    if(process.argv.length > 2){
        // first argument of the program (start from 2) is chain name or json
        var parameter = process.argv[2]
        // second until last arguments are input of the first chain
        var argv = process.argv.slice(3)
        // execute Yaml
        chimera.core.executeChain(parameter, argv)
    }
    else{
        // show missing arguments warning
        console.error('Missing Arguments')
        console.error('USAGE:')
        console.error('* ' + process.argv[1] + ' [chain-file]')
        console.error('* ' + process.argv[1] + ' [yaml-formatted-chain]')
    }
}
