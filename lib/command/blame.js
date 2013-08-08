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

function BlameCommand() {
    Command.call(this);
}

BlameCommand.TYPE = 'blame';
util.inherits(BlameCommand, Command);

Command.mix(BlameCommand, {
    synopsis: function () {
        return "isolates failure-inducing code changes using Delta Debugging algorithms";
    },

    usage: function () {
        console.error('\nUsage: ' + this.toolName() + ' ' + this.type()
            + ' <options> [<commit>] [<commit>]\n\nOptions are:\n\n'
            + [
                formatOption('-t, --test <command>', 'the command used to test success or failure, depending on its exit code'),
                formatOption('-v, --verbose', 'verbose mode')
            ].join('\n\n') + '\n');
        console.error('\n');
    },
    run: function (args, callback) {
        return callback();
    }
});


module.exports = BlameCommand;
