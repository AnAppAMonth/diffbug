/*jslint nomen: true */
var path = require('path'),
    cp = require('child_process'),
    MAIN_FILE = path.resolve(__dirname, '..', 'lib', 'diffbug.js'),
    DEFAULT_CWD = path.resolve(__dirname, 'cli', 'sample-project'),
    verbose = false,
    OPTS = {
    };

/*
 * This class does the following:
 *
 *  1. Create a child process to run the supplied diffbug command
 *  2. Callback the test case with an object that allows the test case
 *      to grep on stdout and stderr, inspect exit codes etc.
 *  3. This is a "correct" test because we run the commands exactly as they
 *      would be run by the user.
 */

function setVerbose(flag) {
    verbose = flag;
}
function setOpts(userOpts) {
    Object.keys(userOpts).forEach(function (k) { OPTS[k] = userOpts[k]; });
}

function resetOpts() {
    OPTS = {};
}

function runCommand(command, args, envVars, callback) {
    var cmd = 'node',
        env = {},
        handle,
        out = '',
        err = '',
        exitCode = 1,
        grepper = function (array) {
            return function (pat) {
                var filtered = array.filter(function (item) {
                    return item.match(pat);
                });
                if (filtered.length === 0) {
                    if (verbose) {
                        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
                        console.log('Could not find: ' + pat + ' in:');
                        console.log(array.join('\n'));
                        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
                    }
                }
                return filtered.length > 0;
            };
        };

    if (command) {
        args.unshift(command);
    }
    args.unshift(MAIN_FILE);

    if (!callback && typeof envVars === 'function') {
        callback = envVars;
        envVars = {};
    }

    Object.keys(process.env).forEach(function (key) {
        env[key] = process.env[key];
    });

    Object.keys(envVars).forEach(function (key) {
        env[key] = envVars[key];
    });

    handle = cp.spawn(cmd, args, { env: env, cwd: OPTS.cwd || DEFAULT_CWD });
    handle.stdout.setEncoding('utf8');
    handle.stderr.setEncoding('utf8');
    handle.stdout.on('data', function (data) {
        out += data;
        if (verbose) {
            process.stdout.write(data);
        }
    });
    handle.stderr.on('data', function (data) {
        err += data;
        if (verbose) {
            process.stderr.write(data);
        }
    });
    handle.on('exit', function (code) {
        exitCode = code;
        setTimeout(function () {
            out = out.split(/\r?\n/);
            err = err.split(/\r?\n/);
            callback({
                succeeded: function () { return exitCode === 0; },
                exitCode: exitCode,
                stdout: function () { return out; },
                stderr: function () { return err; },
                grepOutput: grepper(out),
                grepError: grepper(err)
            });
        }, 100);
    });
}

module.exports = {
    setVerbose: setVerbose,
    runCommand: runCommand,
    resetOpts: resetOpts,
    setOpts: setOpts
};
