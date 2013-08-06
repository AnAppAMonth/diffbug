/**
 * Helper function for running console commands.
 *
 * By Feng Qiu <feng@ban90.com>
 */

var child_process = require('child_process');
var Q = require('q');

/**
 * Run the specified command and return a promise that resolves to its result.
 *
 * @param {string} cmd - The command to execute.
 * @returns {promise} Resolves to the result of the command or rejects if it fails.
 */
function execCmd(cmd) {
    var deferred = Q.defer();
    child_process.exec(cmd, function(err, stdout/*, stderr*/) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(stdout);
        }
    });
    return deferred.promise;
}

module.exports = execCmd;
