/**
 * Copyright (c) 2012, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 *
 * Adapted from the Istanbul project (https://github.com/gotwarlost/istanbul).
 * By Feng Qiu <feng@ban90.com>
 */

var Factory = require('../util/factory'),
    factory = new Factory('vcs', __dirname, false);

/**
 * An abstraction for seemlessly dealing with different VCS software.
 * This class is both the base class as well as a factory for `Vcs` implementations.
 *
 * Usage
 * -----
 *
 *      var Vcs = require('diffbug').Vcs,
 *          git = Vcs.create('git');
 *
 *      //basic use
 *      var root;
 *      git.getRoot()
 *      .then(function(res) {
 *          root = res;
 *      })
 *      .catch(function(err) {
 *          console.log("We are not in a Git repo!");
 *      })
 *      .done();
 *
 * @class Vcs
 * @constructor
 * @protected
 * @param {Object} [options] - The options supported by a specific VCS implementation.
 */
function Vcs(/* options */) {}

//add register, create, mix, loadAll, getVcsList as class methods
factory.bindClassMethods(Vcs);

Vcs.prototype = {
    /**
     * Get the root directory of the VCS repo in which the current working
     * directory lives.
     *
     * @method getRoot
     * @returns {promise} Promise for the result.
     */
    getRoot: function() { throw new Error("getRoot: must be overridden"); },

    /**
     * Read the content of the file from the specified commit. If the commit
     * doesn't contain this file, the returned promise will resolve to null.
     *
     * @method readFileFromCommit
     * @param {string} path - Path of the target file (relative to the VCS root).
     * @param {string} commit - Identifier of the target commit, can be anything
     *                          the VCS supports for identifying a commit.
     * @returns {promise} Promise for the result.
     */
    readFileFromCommit: function(/* path, commit */) {
        throw new Error("readFileFromCommit: must be overridden");
    }
};

module.exports = Vcs;

Vcs.loadAll();
