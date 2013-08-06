var main = require('../../index');


module.exports = {
    "xface": function (test) {
        [ 'Instrumenter', 'Store', 'Vcs', 'matcherFor'].forEach(function (key) {
            test.ok(main[key] && typeof main[key] === 'function', key + ' was not exported as a function!');
        });
        [ 'hook' ].forEach(function (key) {
            test.ok(main[key] && typeof main[key] === 'object', key + ' was not exported as an object!');
        });
        test.done();
    }
};