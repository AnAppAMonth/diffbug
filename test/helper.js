/*jslint nomen: true */
var Instrumenter = require('../lib/instrumenter'),
    vm = require('vm'),
    NO_OP = function () {};


function Verifier(opts) {
    this.file = opts.file;
    this.fn = opts.fn;
    this.code = opts.code;
    this.generatedCode = opts.generatedCode;
    this.err = opts.err;
    this.debug = opts.debug;
    this.traceVariable = opts.traceVariable || '__trace__';
}

function pad(str, len) {
    var blanks = '                                             ';
    if (str.length >= len) {
        return str;
    }
    return blanks.substring(0, len - str.length) + str;
}

function annotatedCode(code) {
    var line = 0,
        annotated = code.map(function (str) { line += 1; return pad(line, 6) + ': ' + str; });
    return annotated.join('\n');
}

Verifier.prototype = {

    verify: function (test, args, expectedOutput, expectedTrace) {

        if (this.err) {
            test.ok(false, "Cannot call verify when errors present");
            return;
        } else if (this.fn === NO_OP) {
            test.ok(false, "Cannot call verify for noop");
            return;
        }
        var actualOutput = this.fn(args),
            fullTrc = global[this.traceVariable],
            trc = fullTrc[Object.keys(fullTrc)[0]];

        test.ok(trc && typeof trc === 'object', 'No trace found for [' + this.file + ']');
        test.deepEqual(expectedOutput, actualOutput, 'Output mismatch');
        test.deepEqual(expectedTrace.functions, trc.f, 'Function trace mismatch');
        test.deepEqual(expectedTrace.branches, trc.b, 'Branch trace mismatch');
        test.deepEqual(expectedTrace.statements, trc.s, 'Statement trace mismatch');
    },

    getTrace: function () {
        return global[this.traceVariable];
    },

    verifyError: function (test) {
        test.ok(this.err && typeof this.err === 'object', 'Error should be an object');
    },

    verifyNoError: function (test) {
        test.ok(!(this.err && typeof this.err === 'object'), 'Error should not be present');
    }
};

function setup(file, codeArray, opts) {

    opts = opts || {};
    opts.file = file;
    opts.debug = opts.debug || process.env.DEBUG;

    var expectError = opts.expectError,
        //exercise the case where RE substitutions for the preamble have $ signs
        traceVariable = typeof opts.traceVariable === 'undefined' ? '$$trace$$' : opts.traceVariable,
        ps = opts.embedSource || false,
        verifier,
        trace = new Instrumenter({
            debug: opts.debug,
            walkDebug: opts.walkDebug,
            noAutoWrap: opts.noAutoWrap,
            traceVariable: traceVariable,
            embedSource: ps
        }),
        args = [ codeArray.join("\n")],
        callback = function (err, generated) {
            if (err) {
                if (expectError) {
                    verifier = new Verifier({ debug: opts.debug, file: file, fn: NO_OP, code: codeArray });
                } else {
                    console.error(err);
                    console.error(err.stack);
                    verifier = new Verifier({ debug: opts.debug, file: file, err: err, code: codeArray });
                }
                return;
            }
            var wrappedCode = '(function (args) { var output;\n' + generated + '\nreturn output;\n})',
                fn;
            global[traceVariable] = undefined;
            fn = vm.runInThisContext(wrappedCode, __filename);
            verifier = new Verifier({ debug: opts.debug, file: file, fn: fn, code: codeArray,
                generatedCode: generated, traceVariable: traceVariable });
            if (opts.debug) {
                console.log('================== Original ============================================');
                console.log(annotatedCode(codeArray));
                console.log('================== Generated ===========================================');
                console.log(generated);
                console.log('========================================================================');
            }
        };

    if (file) { args.push(file); }
    args.push(callback);
    delete opts.expectError;
    trace.instrument.apply(trace, args);

    return verifier;
}

exports.verifier = setup;
