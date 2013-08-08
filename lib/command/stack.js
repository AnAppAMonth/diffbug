/**
 * Copyright (c) 2012, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 *
 * Adapted from the Istanbul project (https://github.com/gotwarlost/istanbul).
 * By Feng Qiu <feng@ban90.com>
 */

var Command = require('./index.js'),
    util = require('util'),
    formatOption = require('../util/help-formatter').formatOption;

function StackCommand() {
    Command.call(this);
}

StackCommand.TYPE = 'stack';
util.inherits(StackCommand, Command);

Command.mix(StackCommand, {
    synopsis: function () {
        return "executes a Node.js program and if an uncaught exception is encountered, annotates its stack " +
                "trace with code lines surrounding each callsite, complete with information on which lines are " +
                "changed against a certain commit";
    },

    usage: function () {
        console.error('\nUsage: ' + this.toolName() + ' ' + this.type()
            + ' [<options>] <executable-js-file-or-command> [-- <arguments-to-jsfile>]\n\nOptions are:\n\n'
            + [
                formatOption('-b, --base <commit>', 'the base commit to compare against. If omitted, HEAD is used'),
                formatOption('--[no-]color', 'whether to colorize the output. Default is to colorize iff stdout is a tty'),
            ].join('\n\n') + '\n');
        console.error('\n');
    },
    run: function (args, callback) {
        return callback();
    }
});


module.exports = StackCommand;
