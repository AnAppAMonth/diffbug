/**
 * Copyright (c) 2012, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 *
 * Adapted from the Istanbul project (https://github.com/gotwarlost/istanbul).
 * By Feng Qiu <feng@ban90.com>
 */

var util = require('util'),
    formatOption = require('../util/help-formatter').formatOption,
    Command = require('./index');

function TraceCommand() {
    Command.call(this);
}

TraceCommand.TYPE = 'trace';
util.inherits(TraceCommand, Command);

Command.mix(TraceCommand, {
    synopsis: function () {
        return "transparently traces the execution of a Node.js program. Saves data and prints summary at the end of execution";
    },

    usage: function () {
        console.error('\nUsage: ' + this.toolName() + ' ' + this.type()
            + ' [<options>] <executable-js-file-or-command> [-- <arguments-to-jsfile>]\n\nOptions are:\n\n'
            + [
                formatOption('--root <path> ', 'the root path to look for files to instrument, defaults to .'),
                formatOption('-x <exclude-pattern> [-x <exclude-pattern>]', 'one or more fileset patterns e.g. "**/vendor/**"'),
                formatOption('--[no-]default-excludes', 'apply default excludes [ **/node_modules/**, **/test/**, **/tests/** ], defaults to true'),
                formatOption('--hook-run-in-context', 'hook vm.runInThisContext in addition to require (supports RequireJS), defaults to false'),
                formatOption('--post-require-hook <file> | <module>', 'JS module that exports a function for post-require processing'),
                formatOption('--verbose, -v', 'verbose mode')
            ].join('\n\n') + '\n');
        console.error('\n');
    },

    run: function (args, callback) {
        var Module = require('module'),
            path = require('path'),
            fs = require('fs'),
            nopt = require('nopt'),
            which = require('which'),
            existsSync = fs.existsSync || path.existsSync,
            inputError = require('../util/input-error'),
            matcherFor = require('../util/file-matcher').matcherFor,
            Instrumenter = require('../instrumenter'),
            hook = require('../hook'),
            resolve = require('resolve'),
            config = {
                root: path,
                x: [Array, String],
                verbose: Boolean,
                yui: Boolean,
                'default-excludes': Boolean,
                'self-test': Boolean,
                'hook-run-in-context': Boolean,
                'post-require-hook': String
            },
            opts = nopt(config, { v : '--verbose' }, args, 0),
            cmdAndArgs = opts.argv.remain,
            cmd,
            cmdArgs,
            runFn,
            excludes;

        if (cmdAndArgs.length === 0) {
            return callback(inputError.create('Need a filename argument for the ' + this.type() + ' command!'));
        }

        cmd = cmdAndArgs.shift();
        cmdArgs = cmdAndArgs;

        if (!existsSync(cmd)) {
            try {
                cmd = which.sync(cmd);
            } catch (ex) {
                return callback(inputError.create('Unable to resolve file [' + cmd + ']'));
            }
        } else {
            cmd = path.resolve(cmd);
        }

        runFn = function () {
            process.argv = ["node", cmd].concat(cmdArgs);
            if (opts.verbose) {
                console.log('Running: ' + process.argv.join(' '));
            }
            process.env.running_under_diffbug=1;
            Module.runMain(cmd, null, true);
        };

        excludes = typeof opts['default-excludes'] === 'undefined' || opts['default-excludes'] ?
                [ '**/node_modules/**', '**/test/**', '**/tests/**' ] : [];
        excludes.push.apply(excludes, opts.x);

        matcherFor({
            root: opts.root || process.cwd(),
            includes: [ '**/*.js' ],
            excludes: excludes
        },
        function (err, matchFn) {
            if (err) { return callback(err); }

            var traceVar = '$$trc_' + new Date().getTime() + '$$',
                instrumenter = new Instrumenter({ traceVariable: traceVar }),
                transformer = instrumenter.instrumentSync.bind(instrumenter),
                hookOpts = { verbose: opts.verbose },
                postRequireHook = opts['post-require-hook'],
                postLoadHookFile;

            if (postRequireHook) {
                postLoadHookFile = path.resolve(postRequireHook);
            } else if (opts.yui) { //EXPERIMENTAL code: do not rely on this in anyway until the docs say it is allowed
                postLoadHookFile = path.resolve(__dirname, '../../util/yui-load-hook');
            }

            if (postRequireHook) {
                if (!existsSync(postLoadHookFile)) { //assume it is a module name and resolve it
                    try {
                        postLoadHookFile = resolve.sync(postRequireHook, { basedir: process.cwd() });
                    } catch (ex) {
                        if (opts.verbose) { console.error('Unable to resolve [' + postRequireHook + '] as a node module'); }
                    }
                }
            }
            if (postLoadHookFile) {
                if (opts.verbose) { console.log('Use post-load-hook: ' + postLoadHookFile); }
                hookOpts.postLoadHook = require(postLoadHookFile)(matchFn, transformer, opts.verbose);
            }

            if (opts['self-test']) {
                hook.unloadRequireCache(matchFn);
            }
            // runInThisContext is used by RequireJS [issue #23]
            if (opts['hook-run-in-context']) {
                hook.hookRunInThisContext(matchFn, transformer, hookOpts);
            }
            hook.hookRequire(matchFn, transformer, hookOpts);

            //initialize the global variable to stop mocha from complaining about leaks
            global[traceVar] = {};

            process.once('exit', function () {
                var trc;
                if (typeof global[traceVar] === 'undefined' || Object.keys(global[traceVar]).length === 0) {
                    console.error('No trace information was collected, exit without writing trace information');
                    return;
                } else {
                    trc = global[traceVar];
                }
                return callback();
            });
            runFn();
        });
    }
});


module.exports = TraceCommand;
