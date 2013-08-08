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

function MinCommand() {
    Command.call(this);
}

MinCommand.TYPE = 'min';
util.inherits(MinCommand, Command);

Command.mix(MinCommand, {
    synopsis: function () {
        return "minimizes or isolates failure-inducing input using Delta Debugging algorithms";
    },

    usage: function () {
        console.error('\nUsage: ' + this.toolName() + ' ' + this.type()
            + ' <options> <input-file>\n\nOptions are:\n\n'
            + [
                formatOption('-t, --test <command>', 'the command used to test success or failure, depending on its exit code'),
                formatOption('-h, --hierarchical <patterns>',
                    'use this option if the input is hierarchical in nature. <patterns> is consisted of two ' +
                    'JavaScript-style RegExps, separated by a comma, marking the beginning and ending of a ' +
                    'hierarchy, respectively. Example: /{/,/}/'),
                formatOption('-c, --clang', 'C-style hierarchical syntax: a shortcut for "-h /{/,/}/"'),
                formatOption('-x, --xml', 'XML/HTML-style hierarchical syntax: a shortcut for "-h /<[^>]*>/,/<\\/[^>]*>/"'),
                formatOption('-p, --python', 'Python-style hierarchical syntax: hierarchies are marked by the amount of preceding whitespaces'),
                formatOption('-v, --verbose', 'verbose mode')
            ].join('\n\n') + '\n');
        console.error('\n');
    },
    run: function (args, callback) {
        return callback();
    }
});


module.exports = MinCommand;
