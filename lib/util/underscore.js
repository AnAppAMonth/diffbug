/**
 * Load useful mixins into underscore.
 *
 * By Feng Qiu <feng@ban90.com>
 */

var _ = require('underscore');

// Import Underscore.string to separate object, because there are conflict
// functions (include, reverse, contains)
_.str = require('underscore.string');

// Mix in non-conflict functions to Underscore namespace if you want
_.mixin(_.str.exports());

module.exports = _;
