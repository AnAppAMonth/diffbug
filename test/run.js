#!/usr/bin/env node

/*
 * Test runner for all unit tests, also set up as the "npm test" command for the package.
 *
 * Usage: run.js <test-pat>
 *     where <test-pat> is a string to run only those test cases that have the string in the filename
 */

/*jslint nomen: true */
var nodeunit = require('nodeunit'),
    loader = require('./loader'),
    cliHelper = require('./cli-helper');

function runTests(pat) {
    var defaultReporter = nodeunit.reporters['default'];

    cliHelper.setVerbose(process.env.VERBOSE);
    loader.runTests(pat, defaultReporter, undefined, function (err) {
        if (err) { throw err; }
    });
}

runTests(process.argv[2]);
