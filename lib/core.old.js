#! /usr/bin/env node
'use strict';

// imports
let async = require('neo-async')
let fs = require('fs')
let yaml = require('js-yaml')
let stringify = require('json-stringify-safe')
let cmd = require('./cmd.js')
let util = require('./util.js')
let path = require('path')

const KEY_SYNONIM = {
    'process' : 'command',
    'input' : 'ins',
    'inputs' : 'ins',
    'output' : 'out',
    'outs' : 'out',
    'outputs' : 'out',
}

const DEFAULT_VALUE = {
    'out' : '_ans',
    'ins' : [],
    'mode' : 'series',
    'if' : true,
    'while' : false,
}

/**
 * Preprocess ins's shorthand
 * Example:
 *  preprocessChainIns('a, b')
 * Output:
 *  ['a', 'b']
 *
 * @param {object} ins
 */
function preprocessChainIns(chain){
    if('ins' in chain){
        let ins = chain.ins
        if(!util.isArray(ins) && util.isString(ins)){
            // remove spaces
            ins = ins.trim()
            // remove parantheses
            ins = ins.replace(/^\((.*)\)/, '$1')
            // split
            ins = util.smartSplit(ins, ',')
            let newIns = []
            ins.forEach(function(input){
                // remove spaces for each component
                newIns.push(input.trim())
            })
            chain.ins = newIns
        }
    }
    return chain
}

function preprocessLongArrow(chain){
    if('command' in chain){
        let commandParts = util.smartSplit(chain.command, '-->')
        if(commandParts.length == 2){
            chain.ins = commandParts[0]
            chain.out = commandParts[1]
            chain.command = ''
        }
    }
    return chain
}

function preprocessArrow(chain){
    if('command' in chain){
        let commandParts = util.smartSplit(chain.command, '->')
        for(let i=0; i<commandParts.length; i++){
            commandParts[i] = util.unquote(commandParts[i].trim())
        }
        // if commandParts has 3 elements, then they must be input, process and output
        if(commandParts.length == 3){
            chain.ins = commandParts[0]
            chain.command = commandParts[1]
            chain.out = commandParts[2]
        }
        else if(commandParts.length == 2){
            if(commandParts[0].match(/^\(.*\)$/g)){
                // input and process
                chain.ins = commandParts[0]
                chain.command = commandParts[1]
            }
            else{
                // process and output
                chain.command = commandParts[0]
                chain.out = commandParts[1]
            }
        }
    }
    return chain
}

function preprocessChainCommand(chain){
    chain = preprocessLongArrow(chain)
    chain = preprocessArrow(chain)
    if('command' in chain){
        if(chain.command == ''){
            // default command: if only single argument is present, then return it, otherwise combine the arguments as array
            chain.command = '(...args)=>{if(args.length==1){return args[0];}else{return args;}}';
        }
        else if(chain.command.match(/^\[@.*\]$/g)){
            // load things from chimera-framework?
            chain.command = chain.command.replace(/^\[@/g, '[chimera-framework ')
        }
    }
    return chain
}

function preprocessChainError(chain){
    // preprocess 'error'
    if('error' in chain && (('mode' in chain && 'chains' in chain) || 'command' in chain)){
        let subChain = {}
        if('mode' in chain && 'chains' in chain){
            subChain.mode = chain.mode
            subChain.chains = chain.chains
            delete chain.mode
            delete chain.chains
        }
        else if('command' in chain){
            subChain.mode = 'series'
            subChain.command = chain.command
            delete chain.command
        }
        chain.mode = 'series'
        // create last chain
        let lastChain = {'if': chain.error, 'mode': 'series', 'chains' : []}
        if('error_message' in chain){
            lastChain.chains.push('('+stringify(chain.error_message)+')-->_error_message')
        }
        if('error_actions' in chain){
            for(let i=0; i<chain.error_actions.length; i++){
                let action = chain.error_actions[i]
                lastChain.chains.push(action)
            }
        }
        lastChain.chains.push('("true")-->_error')
        chain.chains = [subChain, lastChain]
    }
    return chain
}

function preprocessChainMode(chain){
    // preprocess 'series' shorthand
    if('series' in chain){
        chain.mode = 'series'
        chain = util.replaceKey(chain, 'series', 'chains')
    }
    // preprocess 'parallel' shorthand
    if('parallel' in chain){
        chain.mode = 'parallel'
        chain = util.replaceKey(chain, 'parallel', 'chains')
    }
    return chain
}

function preprocessChainRoot(chain){
    chain = util.assignDefaultValue(chain, 'verbose', false)
    chain = util.assignDefaultValue(chain, 'vars', {})
    // define subchain
    let subChain = {}
    if ('chains' in chain){
        subChain = {'chains' : chain.chains}
    }
    else if('command' in chain){
        chain.mode = 'series'
        subChain = {'command': chain.command, 'ins' : chain.ins, 'out' : chain.out}
        delete chain.command
    }
    // adjust the keys
    let keys = ['mode', 'if', 'while']
    for(let key of keys){
        if(key in chain){
            subChain[key] = chain[key]
        }
        if(key != 'mode'){
            delete(chain[key])
        }
    }
    chain.chains = [subChain]
    return chain
}

/**
 * Preprocess chain's shorthand.
 * Example:
 *  preprocessChain({'series' : ['python add.py 5 6']})
 * Output:
 *  {'mode' : 'series', 'chains' : ['python add py 5 6']}
 *
 * @param {object} chain
 */
function preprocessChain(chain, isRoot){
    // if chain is a string, cast it into object
    if(chain == null){
        chain = ''
    }
    if(util.isString(chain)){
        chain = {'command' : chain}
    }
    // other process require chain to be object
    if(util.isRealObject(chain)){
        // adjust keys
        chain = util.replaceKey(chain, KEY_SYNONIM)
        // preprocess input, command and error
        let preprocessor = util.compose(preprocessChainError, preprocessChainMode, preprocessChainIns, preprocessChainCommand)
        chain = preprocessor(chain)
        // default values
        chain = util.assignDefaultValue(chain, DEFAULT_VALUE)
        // recursive subchain preprocessing
        if('chains' in chain){
            for(let i=0; i<chain.chains.length; i++){
                chain.chains[i] = preprocessChain(chain.chains[i], false)
            }
        }
        // for root, move chain to lower level
        if(isRoot){
            chain = preprocessChainRoot(chain)
        }
        // return chain
        return chain
    }
    return false
}

/**
 * Show current time in nano second, and return it
 * Example:
 *  startTime = showStartTime('myProcess')
 */
function showStartTime(processName, chainOptions){
    let trimmedProcessName = util.sliceString(processName, 100)
    let startTime = process.hrtime();
    if(chainOptions.description != ''){
        console.warn('[INFO] ' + String(chainOptions.description))
    }
    console.warn('[INFO] PROCESS NAME : ' + util.sliceString(processName, 500))
    console.warn('[INFO] START PROCESS  ' + trimmedProcessName + ' AT    : ' + util.formatNanoSecond(startTime))
    return startTime
}

/**
 * Show current time in nano second, and calculate difference from startTime
 * Example:
 *  showEndTime('myProcess', startTime)
 */
function showEndTime(processName, startTime){
    let trimmedProcessName = util.sliceString(processName, 100)
    let diff = process.hrtime(startTime);
    let endTime = process.hrtime();
    console.warn('[INFO] END PROCESS    ' + trimmedProcessName + ' AT    : ' + util.formatNanoSecond(endTime))
    console.warn('[INFO] PROCESS        ' + trimmedProcessName + ' TAKES : ' + util.formatNanoSecond(diff) + ' NS')
}

function showKeyVal(vars, spaces){
    for(let key in vars){
        let strVal = stringify(vars[key])
        if(util.isNull(strVal)){
            strVal = 'null'
        }
        else if(util.isUndefined(strVal)){
            strVal = 'undefined'
        }
        if(strVal.length <= 250 || util.isString(vars[key])){
            strVal = util.sliceString(strVal, 500)
            console.warn(spaces + key + ' : ' + strVal)
        }
        else{
            console.warn(spaces + key + ' :')
            showKeyVal(vars[key], spaces + '  ')
        }
    }
}

function showVars(processName, vars){
    processName = util.sliceString(processName, 500)
    console.warn('[INFO] STATE AFTER    '+processName+' : ')
    showKeyVal(vars, '        ')
}

function showFailure(processName){
    processName = util.sliceString(processName, 500)
    console.error('[ERROR] FAILED TO PROCESS   ['+processName+']')
}


function runModule(moduleName, inputs, cwd, callback){
    // get real moduleName
    let moduleNameParts = util.smartSplit(moduleName, ' ')
    for(let i=0; i<moduleNameParts.length; i++){
        moduleNameParts[i] = util.unquote(moduleNameParts[i])
    }
    moduleName = moduleNameParts[0]
    let theModule
    try{
        theModule = require(moduleName)
    }
    catch(error){
        theModule = require(util.addTrailingSlash(cwd) + moduleName)
    }
    // determine runner
    let runner
    if(!util.isNullOrUndefined(theModule)){
        if(moduleNameParts.length == 1){
            runner = theModule
        }
        else{
            let runnerParts = moduleNameParts.slice(1)
            let runnerName = runnerParts.join(' ')
            let runnerNameParts = runnerName.split('.')
            runner = theModule
            for(let i=0; i<runnerNameParts.length; i++){
                runner = runner[runnerNameParts[i]]
            }
        }
    }
    if(util.isNullOrUndefined(runner)){
        // if cannot find runner, ditch it
        callback(new Error('Cannot get executable function from '+moduleName), '')
    }
    else{
        // add callback as input argument
        let args = inputs
        args.push(callback)
        // run runner with arguments inside cwd
        runner.apply(runner, args)
    }
}

/**
 * Execute chain configuration
 * Example
 *  var chainConfig = {
 *      'series' : {'command': 'python operation.py', 'ins': ['a, 'b', 'operation'], 'out': 'c'},
 *      'ins':['a','b'],
 *      'out':'c'};
 *  execute(chainConfig, [5 6], {'operation' : 'plus'}, function(result, success, errorMessage){console.log(out);});
 *  execute(chainConfig, [5 6], {'operation' : 'plus'});
 *  execute(chainConfig, [5 6]);
 *  execute(chainConfig);
 *
 * @params {object} chainConfig
 * @params {array} argv
 * @params {object} presets
 * @params {function} finalCallback
 */
function execute(chainConfigs, argv, presets, finalCallback, chainOptions){
    // define some closures
    let ins, out, vars, chains, mode, verbose

    // wrap the final callback
    let wrappedFinalCallback = (error, output)=>{
        if(error){
            // if error, the output must be ''
            output = ''
            // if there is no error message, put a default one
            if(error.message == ''){
                error.message = 'Cannot execute chain'
            }
        }
        else if(output == ''){
            // if not error but output is empty, try to get it from vars
            output = out in vars? vars[out]: ''
        }
        return finalCallback(error, output)
    }

    // run the main function
    main()

    function main(){
        // argv should be array
        if(!util.isArray(argv)){
            argv = []
        }
        // preprocessing
        chainConfigs = preprocessChain(chainConfigs, true)
        // don't do anything if chainConfigs is wrong
        if(chainConfigs === false){
            console.error('[ERROR] Unable to fetch chain')
            wrappedFinalCallback(new Error('Unable to fetch chain', false))
            return null
        }
        // get ins, out, vars, chains, mode, and verbose
        ins     =  chainConfigs.ins
        out     =  chainConfigs.out
        vars    =  chainConfigs.vars
        chains  =  chainConfigs.chains
        mode    =  chainConfigs.mode
        verbose =  chainConfigs.verbose
        // override vars with presets
        if(util.isRealObject(presets)){
            for(let key in presets){
                vars[key] = presets[key]
            }
        }
        // populate "vars" with "ins" and "process.argv"
        for(let index=0; index<ins.length; index++){
            let key = ins[index]
            if(index < argv.length){
                setVar(key, argv[index])
            }
            else if(!(key in vars)){
                setVar(key, 0)
            }
        }
        // add "out" to "vars"
        vars = util.assignDefaultValue(vars, out, '')
        // add "cwd"
        setVar('_chain_cwd', util.addTrailingSlash(chainOptions.cwd))
        setVar('_init_cwd', util.addTrailingSlash(process.cwd()))
        // run the chains
        try{
            runChains(chains, mode, true)
        }
        catch(error){
            wrappedFinalCallback(error, '')
            return null
        }
    }

    function getNonLiteralVar(key){
        let attempt = 0
        while(attempt < 10){
            try{
                return eval('vars.'+key)
            }
            catch(error){
                // try parse array key
                let newKey = key.replace(/\[([^\[\]]+)\]/g, function(element){
                    element = element.replace(/\[|\]/g, '')
                    return '[' + stringify(getVar(element)) + ']'
                }) 
                if(newKey == key){
                    break
                }
                else{
                    key = newKey
                }
            }
            attempt--
        }
        return 0
    }

    function getVar(key){
        if(key.match(/^null$/gi) || key.match(/^none$/gi)){
            return null
        }
        else if(key.match(/^true$/gi)){
            return true
        }
        else if(key.match(/^false$/gi)){
            return false
        }
        else if(key.match(/^-?[0-9]+\.?[0-9]*$/g)){
            return parseFloat(key)
        }
        else if(key.match(/^".*"$/g) || key.match(/^'.*'$/g)){
            // it is literal
            let value = util.unquote(key)
            // turn it into object
            try{
                value = JSON.parse(value)
            }
            catch(err){
                value = JSON.parse(stringify(value))
            }
            return value
        }
        return getNonLiteralVar(key)
    }

    function setVar(key, value){
        if(util.isString(value)){
            // remove trailing new lines or trailing spaces
            value = value.replace(/[ \n]+$/g, '')
            // If the value can be parsed into object, parse it
            try{
                value = JSON.parse(value);
            } catch(e){}
        }
        let keyParts = key.split('.')
        // bypass everything if the key is not nested
        if(keyParts.length == 1){
            vars[key] = value
        }
        // recursively set value of vars
        let obj = vars
        for(let i=0; i<keyParts.length; i++){
            let keyPart = keyParts[i]
            // last part
            if(i == keyParts.length -1){
                obj[keyPart] = value
            }
            // middle part
            else{
                // define object if not defined
                if(!('keypart') in obj || !util.isRealObject(obj[keyPart])){
                    obj[keyPart] = {}
                }
                // Traverse. Javacript has "call by reference" !!!
                obj = obj[keyPart]
            }
        }
    }

    function getInputParameters(chainIns, chainCommand){
        let parameters = []
        for(let key of chainIns){
            let arg = getVar(key)
            // determine whether we need to add quote
            let addQuote = false
            if(chainCommand.match(/^\[.*\]$/g)){
                // if it is module, don't add quote
                addQuote = false
            }
            else if(chainCommand.match(/.*=>.*/g)){
                // if it is javascript arrow function and the arg is not json qualified, we also need to add quote
                arg = stringify(arg)
                try{
                    let tmp = JSON.parse(arg)
                }
                catch(err){
                    addQuote = true
                }
            }
            else{
                // if it is not javascript, we need to add quote, except it is already quoted
                arg = stringify(arg)
                if(!arg.match(/^"(.*)"$/g) && !arg.match(/^'(.*)'$/g)){
                    addQuote = true
                }
            }
            // add quote if necessary
            if(addQuote){
                arg = util.quote(arg)
            }
            parameters.push(arg)
        }
        return parameters
    }

    function getSingleModuleChainRunner(chainCommand, chainOut, parameters, callback){
        let moduleName = chainCommand.substring(1, chainCommand.length-1)
        let logCommand = 'runModule('+stringify(moduleName)+', '+stringify(parameters)+', '+stringify(chainOptions.cwd)+', callback)'
        logCommand = util.sliceString(logCommand, 500)
        let startTime
        if(verbose){
            startTime = showStartTime(logCommand, chainOptions)
        }
        try{
            runModule(moduleName, parameters, chainOptions.cwd, function(error, output){
                // set default output
                if(util.isNullOrUndefined(output)){ output = 0; }
                // set variable
                setVar(chainOut, output)
                if(verbose){
                    showEndTime(moduleName, startTime)
                    showVars(moduleName, vars)
                }
                // if error, just stop the chain, and call the last callback
                if(getVar('_error') || error){
                    if(getVar('_error') == true){
                        error = new Error(getVar('_errorMessage'))
                        error.message = getVar('_error_message')
                    }
                    error.message += ', Script : ' + logCommand
                    wrappedFinalCallback(error, '')
                }
                else{
                    // continue the chain
                    callback()
                }
            })
        }catch(error){
            showFailure(logCommand)
            error.message += ', Script : ' + logCommand
            wrappedFinalCallback(error, '')
        }
    }

    function getSingleArrowFunctionChainRunner(chainCommand, chainOut, parameters, callback){
        // if chainCommand is purely javascript's arrow function, we can simply use eval
        let jsScript = '(' + chainCommand + ')(' + parameters.join(', ') + ')'
        let logCommand = util.sliceString(jsScript, 500)
        let startTime
        if(verbose){
            startTime = showStartTime(jsScript, chainOptions)
        }
        try{
            let output = eval(jsScript)
            // assign as output
            setVar(chainOut, output)
            if(verbose){
                showEndTime(jsScript, startTime)
                showVars(jsScript, vars)
            }
            // if error, just stop the chain, and call the last callback
            if(getVar('_error') == true){
                error = new Error(getVar('_errorMessage'))
                error.message += ', Script : ' + logCommand
                wrappedFinalCallback(error, '')
            }
            else{
                // continue the chain
                callback()
            }
        }
        catch(error){
            showFailure(logCommand)
            error.message += ', Script : ' + logCommand
            wrappedFinalCallback(error, '')
        }
    }


    function getSingleCmdChainRunner(chainCommand, chainOut, parameters, callback){
        // add parameter to chainCommand
        let cmdCommand = chainCommand + ' ' + parameters.join(' ')
        let logCommand = util.sliceString(cmdCommand, 500)
        // benchmarking
        let startTime
        if(verbose){
            startTime = showStartTime(cmdCommand, chainOptions)
        }
        // run the command
        try{
            cmd.get(cmdCommand, {'cwd': chainOptions.cwd}, function(error, stdout, stderr){
                // set default output
                if(util.isNullOrUndefined(stdout)){ stdout = 0; }
                // set variable
                setVar(chainOut, stdout)
                // assign as output
                if(verbose){
                    showEndTime(cmdCommand, startTime)
                    showVars(cmdCommand, vars)
                }
                // it might be no error, but stderr exists
                if(stderr != ''){
                    console.warn(stderr)
                }
                // run callback
                if(getVar('_error') || error){
                    // if error, just stop the chain, and call the last callback
                    if(getVar('_error')){
                        error = new Error(getVar('_errorMessage'))
                        error.message += ', Command : ' + logCommand
                    }
                    wrappedFinalCallback(error, '')
                }
                else{
                    callback()
                }
            })
        }
        catch(error){
            showFailure(logCommand)
            error.message += ', Command : ' + logCommand
            wrappedFinalCallback(error, '')
        }
    }

    function getSingleChainRunner(chain){
        return function(callback){
            // get command, ins, and out
            let chainCommand = chain.command
            let chainIns = chain.ins
            let chainOut = chain.out
            let parameters = getInputParameters(chainIns, chainCommand)
            let startTime = 0
            if(chainCommand.match(/^\[.*\]$/g)){
                getSingleModuleChainRunner(chainCommand, chainOut, parameters, callback)
            }
            else if(chainCommand.match(/.*=>.*/g)){
                getSingleArrowFunctionChainRunner(chainCommand, chainOut, parameters, callback)
            }
            else{
                getSingleCmdChainRunner(chainCommand, chainOut, parameters, callback)
            }
        }
    }

    // function to build another another function
    // the function returned will execute a single chain
    function getChainRunner(chain){
        if('chains' in chain){
            // chain has other subChains
            let subMode = 'mode' in chain? chain.mode: 'series'
            let subChains = 'chains' in chain? chain.chains: []
            return function(callback){
                runChains(subChains, subMode, false, callback)
            }
        }
        else if('command' in chain){
            // chain doesn't have subChains
            return getSingleChainRunner(chain)
        }
        return null
    }

    function isTrue(statement, callback){
        let truth = false
        let script = ''
        try{
            statement = String(statement)
            let re = /([a-zA-Z0-9-_]*)/g
            let words = statement.match(re).filter((value, index, self) =>{
                return self.indexOf(value) === index
            })
            // build script. We need anonymous function for sandboxing
            script += '(function(){try{'
            for(let i=0; i<words.length; i++){
                let word = words[i]
                if(word in vars){
                    script += 'let ' + word + '=' + stringify(getVar(word)) + ';'
                }
            }
            script += 'return ' + statement + ';'
            script += '}catch(error){ return false;}})()'
            // execute script
            truth = eval(script)
        }
        catch(error){
            console.error('[ERROR] Failed to evaluate condition')
            console.error(script)
            console.error(error.stack)
        }
        return truth 
    }

    // get actions that will be used in async process
    function getControlledActions(chains){
        let actions = []
        for(let chain of chains){
            let chainRunner = getChainRunner(chain)
            if(chainRunner != null){
                // need a flag so that the chainRunner will be executed at least once
                let firstRun = true
                let alteredChainRunner = function(callback){
                    // if "chain.if" is true and ("chain.while" is true or this is the first run)
                    // then call the chainRunner
                    if(isTrue(chain.if) && (isTrue(chain.while) || firstRun)){
                        let alteredCallback = function(){
                            firstRun = false
                            alteredChainRunner(callback)
                        }
                        chainRunner(alteredCallback)
                    }
                    // otherwise just execute the callback
                    else{
                        callback()
                    }
                }
                // add to actions
                actions.push(alteredChainRunner)
            }
        }
        return actions
    }

    // run async process
    function runChains(chains, mode, isCoreProcess, runCallback){
        // populate actions
        let actions = getControlledActions(chains)
        // determine asyncRunner
        let asyncRunner
        if(mode == 'parallel'){
            asyncRunner = async.parallel
        }
        else{
            asyncRunner = async.series
        }
        // run actions
        if(isCoreProcess){
            asyncRunner(actions, wrappedFinalCallback)
        }
        else{
            asyncRunner(actions, runCallback)
        }
    }

}

function wrapCallback(finalCallback, previousError){
    return function(error, result){
        if(error && previousError){
            console.error(previousError)
        }
        else{
            if(util.isFunction(finalCallback)){
                // finalCallback exists, execute it
                finalCallback(error, result)
            }
            else if(!error){
                // no finalCallback
                if(util.isRealObject(result) || util.isArray(result)){
                    // object/array should be shown as JSON format
                    console.log(stringify(result))
                }
                else{
                    // otherwise, show it as is
                    console.log(result)
                }
            }
            else{
                console.error(error)
            }
        }
    }
}

function getChainConfig(chainString){
    // get chainConfigs
    let chainConfigs = {}
    try{
        chainConfigs = yaml.safeLoad(chainString)
    }
    catch(yamlError){
        try{
            chainConfigs = JSON.parse(chainString)
        }
        catch(jsonError){
            console.warn('[ERROR] Not a valid YAML or JSON format')
            console.warn('\nString:')
            console.warn(String(chainString))
            console.warn('\nYAML Error:')
            console.warn(yamlError.stack)
            console.warn('\nJSON Error:')
            console.warn(jsonError.stack)
            return null
        }
    }
    return chainConfigs
}

function executeJsonOrYamlScript(chain, argv, presets, wrappedCallback, chainOptions){
    util.parseJsonOrYaml(chain, function(error, obj){
        if(!error){
            chainOptions.description = 'CHAIN SCRIPT : ' + chain
            execute(obj, argv, presets, wrappedCallback, chainOptions)
        }
        else{
            console.error(error)
        }
    })
}

/**
 * Execute chain file
 * Example
 *  executeChain('myChain.yaml', [5 6], {'operation' : 'plus'}, function(result, success){console.log(out);});
 *  executeChain('myChain.yaml', [5 6], {'operation' : 'plus'});
 *  executeChain('myChain.yaml', [5 6]);
 *  executeChain('myChain.yaml');
 *
 * @params {string} chain
 * @params {array} argv
 * @params {object} presets
 * @params {function} finalCallback
 */
function executeChain(chain, argv, presets, finalCallback){
    if(util.isFunction(argv)){
        finalCallback = argv
        argv = []
        presets = {}
    }
    else if(util.isFunction(presets) && util.isArray(argv)){
        finalCallback = presets
        presets = {}
    }
    else if(util.isFunction(presets)){
        finalCallback = presets
        presets = argv
        argv = []
    }
    let chainOptions = {'cwd' : process.cwd(), 'description' : 'No description available'}
    util.readJsonOrYaml(chain, function(error, obj){
        if(!error){
            // chain is yaml/json file, and obj is valid 
            let fileNameParts = chain.split('/')
            if(fileNameParts.length > 1){
                // perform chdir if necessary
                let pathParts = fileNameParts.slice(0,-1)
                let yamlPath = pathParts.join('/')
                chainOptions.cwd = util.addTrailingSlash(path.resolve(yamlPath))
            }
            chainOptions.description = 'CHAIN FILE   : ' + chain
            let wrappedCallback  = wrapCallback(finalCallback)
            execute(obj, argv, presets, wrappedCallback, chainOptions)
        }
        else{
            // invalid JSON/YAML. It is probably yaml/json script
            // Put original error so that the wrappedCallback
            // can inform the user about the error when attempting to readJsonOrYaml error
            let wrappedCallback  = wrapCallback(finalCallback, error)
            executeJsonOrYamlScript(chain, argv, presets, wrappedCallback, chainOptions)
        }
    })
}

function run(...args){
    let chain, argvStartIndex
    let argv = []
    let callback = null
    // get chain and argvStartIndex
    if(args.length > 1 && args[0].substring(args[0].length-1) == '/'){
        chain = args[0] + args[1]
        argvStartIndex = 2
    }
    else{
        chain = args[0]
        argvStartIndex = 1
    }
    // get argv
    let index = argvStartIndex
    while(index < args.length){
        if(!util.isFunction(args[index])){
            argv.push(args[index])
        }
        else{
            callback = args[index]
            break
        }
        index++
    }
    // callback
    if(util.isNullOrUndefined(callback)){
        callback = wrapCallback(callback)
    }
    executeChain(chain, argv, callback)
}

module.exports = {
    'executeChain' : executeChain,
    'run' : run
}