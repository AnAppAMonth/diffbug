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
 * a `Vcs` implementation for Mercurial.
 *
 * Usage
 * -----
 *
 *      var hg = require('diffbug').Vcs.create('hg');
 *
 *
 * @class HgVcs
 * @extends Vcs
 * @constructor
 */
function HgVcs() {
    Vcs.call(this);
}

HgVcs.TYPE = 'hg';
util.inherits(HgVcs, Vcs);

Vcs.mix(HgVcs, {

    getRoot: function() {
        return execCmd('hg root').then(function(result) {
            return _.trim(result);
        });
    },

    readFileFromCommit: function(path, commit) {
        return execCmd(util.format('hg cat -r %s %s', commit, path));
    }
});

module.exports = HgVcs;
