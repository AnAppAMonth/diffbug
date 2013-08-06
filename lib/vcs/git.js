/**
 * Copyright (c) 2012, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 *
 * Adapted from the Istanbul project (https://github.com/gotwarlost/istanbul).
 * By Feng Qiu <feng@ban90.com>
 */

var util = require('util'),
    Vcs = require('./index'),
    execCmd = require('../util/exec-cmd');
    _ = require('../util/underscore');

/**
 * a `Vcs` implementation for Git.
 *
 * Usage
 * -----
 *
 *      var git = require('diffbug').Vcs.create('git');
 *
 *
 * @class GitVcs
 * @extends Vcs
 * @constructor
 */
function GitVcs() {
    Vcs.call(this);
}

GitVcs.TYPE = 'git';
util.inherits(GitVcs, Vcs);

Vcs.mix(GitVcs, {

    getRoot: function() {
        return execCmd('git rev-parse --show-toplevel').then(function(result) {
            return _.trim(result);
        });
    },

    readFileFromCommit: function(path, commit) {
        return execCmd(util.format('git show %s:%s', commit, path));
    }
});

module.exports = GitVcs;
