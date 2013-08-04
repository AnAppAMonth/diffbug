/**
 * This module implements the Probe class, which helps us in debugging to
 * locate the offending context, print out watched variables, and compare
 * their values to those recorded in the same context in a good run.
 *
 * Author: Feng Qiu <feng@ban90.com>
 * Date: 13-7-25
 */

var os = require('os');
var fs = require('fs');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var acorn = require('acorn');
var objectDiff = require('objectdiff');
var ast = require('./ast');
var git = require('./git');

// Stores all probes defined in the program.
// Each key is a filename that's used to store the probe's result.
// Value is an array of probe objects that reside in that file.
var probes = {};

// Stores previous probe results loaded from files.
// Each key is a filename, and value is an object that contains two
// fields: one is an array of probe objects like in `probes`, the
// other is an object that maps probe names to probe indexes, used
// to match named probes.
var savedProbes = {};


// Index probes created in the program with `Probe.createProbe()` by their
// locations and contexts of creation.
//
// Each key is a string composed of 5 parts: the source file name, line
// number, column number of the `Probe.createProbe()` call, and the name
// and filename of the created probe. Value is the probe object.
//
// This dictionary is used to make sure that calling `Probe.createProbe()`
// is safe in places where execution passes many times (eg, loops, event
// handlers), and only one probe instance is created.
var createdProbes = {};

// This dictionary is similar to `createdProbes`, but used to make sure
// other methods of the `Probe()` constructor are safe to call in places
// where execution passes many times.
//
// Each key is a string composed of the source file name, line number,
// column number of the method call, and any additional info specific
// to that method. Value is always 1.
var calledMethods = {};


// Maps source filenames to source file contents.
var fileCache = {};
// Maps each source filename to an array of integers, whose Nth element
// stores offset of the N+1'th line in the file. This is used to convert
// a (lineNumber, columnNumber) pair to the corresponding offset in the
// file.
var fileOffsetCache = {};
// Maps source filenames to AST's constructed from these source files.
var astCache = {};


/**
 * This function returns the specified entry in the callsites array
 * generated from this function.
 *
 * @param i {int} index of the callsite entry to return.
 * @returns {Object} the requested CallSite object.
 * @private
 */
function _getCallSite(i) {
	// First get the callsites leading to this call.
	var callsites;
	var orig = Error.prepareStackTrace;
	Error.prepareStackTrace = function(_, stack) {
		return stack;
	};
	callsites = new Error().stack;
	Error.prepareStackTrace = orig;

	// Return the i'th entry.
	return callsites[i];
}

/**
 * This function is called by `Probe.prototype.watch()` to determine
 * the names (or expr text) of the variables or expressions being
 * watched, so that we can display these names in the output.
 *
 * The biggest problem of implementing such debugging helpers in
 * JavaScript is that, unlike other dynamic languages, it lacks
 * inspection abilities on local variables. We can't fetch a list
 * of local variables in the current scope and print their values.
 *
 * Therefore, the user is required to call `watch()` manually and
 * pass in the variable and expression values to watch, and call
 * it repeatedly to update these values.
 *
 * However, this is not enough, because these are just values,
 * and without readable names of them we can't print a readable
 * list for the user to check out.
 *
 * This function first generates a stack trace to find out the line
 * and column numbers of the user's call to `watch()`, and then use
 * acorn to parse the source file and find the corresponding location
 * in the AST, and finally extract the variable names and expression
 * text from the AST.
 *
 * @returns {Array} array containing the requested names.
 * @private
 */
function _getWatchNames() {
	// Get the CallSite object for the user's `watch()` call.
	var site = _getCallSite(3);
	var fileName = site.getFileName();
	var lineNumber = site.getLineNumber();
	var columnNumber = site.getColumnNumber();
	var fileContent, lines, offsets;
	var ast, offset;
	var i;

	// Read the file and build an AST for it if this hasn't been done
	// already.
	if (fileCache[fileName] === undefined) {
		fileCache[fileName] = fileContent = fs.readFileSync(fileName).toString();
		astCache[fileName] = ast = acorn.parse(fileContent);

		lines = fileContent.split('\n');
		offsets = [0];
		for (i = 0; i < lines.length; i++) {
			offsets.push(offsets[i] + lines[i].length + 1);
		}
		fileOffsetCache[fileName] = offsets;
	} else {
		fileContent = fileCache[fileName];
		offsets = fileOffsetCache[fileName];
		ast = astCache[fileName];
	}

	// Find the offset of the callsite in the file from the line and
	// column numbers.
	offset = offsets[lineNumber - 1] + columnNumber - 1;

	// Find the ExpressionStatement that contains the `watch()` call in
	// the AST at this offset.
	var targetExpr = null;
	function traverse(node) {
		var i;
		if (node.type === 'ExpressionStatement') {
			if (node.start <= offset && node.end > offset) {
				// This Expression Statement is what we are looking for.
				targetExpr = node;
				return;
			}
		}

		// Process its children only if we are not done yet.
		if (node.body instanceof Array) {
			for (i = 0; i < node.body.length; i++) {
				if (targetExpr) {
					return;
				}
				traverse(node.body[i]);
			}
		} else if (node.body) {
			traverse(node.body);
		}
	}
	traverse(ast);

	// Next step is to find the smallest CallExpression inside this
	// node that contains the offset.
	var targetCall = null;
	function traverse2(node) {
		var i, j;
		var keys, value;

		// Note that since we are here, the node must contain the offset.
		if (node.type === 'CallExpression') {
			// Since we traverse from top to bottom, this CallExpression
			// node is definitely smaller than any previous matches.
			targetCall = node;
		}

		// Process its children.
		keys = Object.keys(node);
		for (i = 0; i < keys.length; i++) {
			value = node[keys[i]];
			if (value instanceof Array) {
				for (j = 0; j < value.length; j++) {
					if (value[j] instanceof Object && value[j].type && value[j].end) {
						// This is a node, proceed iff it contains the offset.
						if (value[j].start <= offset && value[j].end > offset) {
							traverse2(value[j]);
						}
					}
				}
			} else if (value instanceof Object && value.type && value.end) {
				// This is a node, proceed iff it contains the offset.
				if (value.start <= offset && value.end > offset) {
					traverse2(value);
				}
			}
		}
	}
	traverse2(targetExpr);

	var result = [];
	var args = targetCall.arguments;
	for (i = 0; i < args.length; i++) {
		var item = fileContent.substring(args[i].start, args[i].end);
		item = item.replace(/\s+/g, '');
		result.push(item);
	}

	return result;
}

/**
 * This function takes a string to be printed to the console, and formats
 * it so that when it wraps, 4 spaces are prepended to the next line to
 * make it more readable.
 *
 * The input string can contain color sequences which take spaces in the
 * string, but not in the printed output. So this function must be able
 * to deal with them.
 *
 * @param str {string} the input string.
 * @returns {string} the output string.
 * @private
 */
function _lineBreak(str) {
	var result = '';
	var consoleColumns = process.stdout.columns;

	// As an optimization, if the length of str (including color sequences)
	// doesn't exceed the console's width, this is definitely an one-liner.
	if (str.length <= consoleColumns) {
		return str;
	}

	// The start index in `str` of the current line.
	var start = 0;
	// The number of actual characters counted into the current line.
	var ct = 0;
	// Whether we are inside a color sequence.
	var inSeq = false;

	for (var i = 0; i < str.length; i++) {
		if (str[i] === '\x1B') {
			inSeq = true;
		} else if (inSeq) {
			if (str[i] === 'm') {
				inSeq = false;
			}
		} else {
			ct++;
			if (str[i] === '\n' || ct === consoleColumns) {
				// We have finished counting a line.
				if (start) {
					// This isn't the first line, prepend '\n' and 4 spaces.
					result += '\n    ';
				} else {
					// This is the first line, all subsequent lines must leave
					// space for the 4 spaces prepended.
					consoleColumns -= 4;
				}
				// Add the line to the result.
				if (str[i] === '\n') {
					// The line break is triggered by a '\n', don't include
					// it into the resulting string.
					result += str.substring(start, i);
				} else {
					result += str.substring(start, i + 1);
				}
				start = i + 1;
				ct = 0;
			}
		}
	}

	// Add the last line to the result.
	if (start) {
		// This isn't the first line, prepend '\n' and 4 spaces.
		result += '\n    ';
	}
	result += str.substring(start);

	return result;
}

/**
 * This function uses the objectdiff library to diff two objects or
 * literals and generates a nice-looking diff (inspired by file diffs)
 * from the result.
 *
 * @param a {*} diff operand 1, can be object or literal.
 * @param b {*} diff operand 2, can be object or literal.
 * @param colors {boolean} whether to colorize the output.
 * @returns {Array} empty if equal, otherwise a list of changes.
 * @private
 */
function _generateObjectDiff(a, b, colors) {
	var result = [];
	var numberPat = /^\d+$/;

	// Format strings
	var changeStr =  ['*   %s = %s -> %s',
					  '\x1B[36m*   %s\x1B[0m = \x1B[31m%s\x1B[0m -> \x1B[32m%s\x1B[0m'];
	var changeStr2 = ['*   %s -> %s',
					  '\x1B[36m*\x1B[0m   \x1B[31m%s\x1B[0m -> \x1B[32m%s\x1B[0m'];
	var removeStr =  ['-   %s = %s',
					  '\x1B[31m-   %s\x1B[0m = \x1B[31m%s\x1B[0m'];
	var addStr =     ['+   %s = %s',
					  '\x1B[32m+   %s\x1B[0m = \x1B[32m%s\x1B[0m'];
	var idx = colors ? 1 : 0;

	// Traverse the diff object to find all changes.
	function traverse(node, path) {
		var keys, i;
		if (node.changed === 'object change') {
			keys = Object.keys(node.value);
			for (i = 0; i < keys.length; i++) {
				var newPath;
				// If the key is a number, it's probably an array index
				if (numberPat.test(keys[i])) {
					newPath = '[' + keys[i] + ']';
					if (path) {
						newPath = path + newPath;
					}
				} else {
					newPath = path ? path + '.' + keys[i] : keys[i];
				}
				traverse(node.value[keys[i]], newPath);
			}

		} else if (node.changed === 'primitive change') {
			result.push(_lineBreak(util.format(changeStr[idx]
											 , path
											 , util.inspect(node.removed)
											 , util.inspect(node.added))));

		} else if (node.changed === 'removed') {
			result.push(_lineBreak(util.format(removeStr[idx]
											 , path
											 , util.inspect(node.value))));

		} else if (node.changed === 'added') {
			result.push(_lineBreak(util.format(addStr[idx]
											 , path
											 , util.inspect(node.value))));
		}
	}

	// objectdiff only supports comparing two objects.
	if (a instanceof Object && b instanceof Object) {
		var diff = objectDiff.diff(a, b);

		traverse(diff, '');

	} else {
		if (a !== b) {
			result.push(_lineBreak(util.format(changeStr2[idx]
											 , util.inspect(a)
											 , util.inspect(b))));
		}
	}

	return result;
}

/**
 * This function generates a file name from a profile name (of Probe).
 * If the profile name is falsy (eg, not set), we generate the file
 * name based on information of the user call that triggered this
 * operation, including source file path and function/method names.
 *
 * The optional callsite argument can be provided by the caller when
 * it already has this information, to avoid us having to get it again.
 *
 * @param profile {string} [optional] the profile name.
 * @param callsite {Object} [optional] the callsite object of the user
 *                          call that triggered this operation.
 * @returns {string} the generated file name (with full path).
 * @private
 */
function _getFileNameFromProfile(profile, callsite) {
	var fileName;

	if (profile) {
		// Get file name from profile name
		fileName = profile + '_probes.json';
	} else {
		// Generate file name automatically, based on the source file
		// path and function/method names of the user call.
		if (!callsite) {
			callsite = _getCallSite(3);
		}

		var str = callsite.getFileName()
				+ callsite.getFunctionName()
				+ callsite.getMethodName();

		fileName = crypto.createHash('sha256').update(str).digest('hex').substring(0,16);
		fileName += '_probes.json';
	}

	return path.join(os.tmpdir(), fileName);
}

/**
 * This function is called at the beginning of the probe's `test()`,
 * `ptest()`, and `pdone()` methods, and is the heart of our auto-
 * detection mechanism of probe types.
 *
 * Whenever one of these methods are called on an unconditional probe,
 * the probe is converted to a conditional probe, and its `count` is
 * reset to 0. The only exception is if the probe has explicitly been
 * set as an unconditional probe by calling `setCountAndType()`, in
 * which case an error is thrown.
 *
 * @param probe {Object} the probe in question.
 * @private
 */
function _testCalled(probe) {
	if (probe._isConditional === false) {
		if (probe._explicitType) {
			throw new Error("Setting conditions on a probe that's explicitly declared as unconditional");
		} else {
			probe._isConditional = true;
			probe._count = 0;
		}
	}
}

/**
 * This function is called by the probe's `watch()`, `test()`, and
 *  `pdone()` methods to check after incrementing its count whether
 * the new count should trigger the firing of the probe.
 *
 * @param probe {Object} the probe in question.
 * @private
 */
function _checkCount(probe) {
	if (probe._target > 0) {
		// `probe.target` is set, fire the probe iff it's met.
		if (probe._count === probe._target) {
			probe.fire('user set N reached');
		}
	} else {
		// Fire the probe if data is available from the previous
		// run in the same context.
		if (probe._saved &&
				probe._saved._count === probe._count &&
				probe._saved._isConditional === probe._isConditional) {
			probe.fire('N from last run');
		}
	}
}

/**
 * Private member variables of `Probe()`.
 *
 * Note that `_fileName` is initialized in one of four possible locations:
 * `Probe.setProfile()`, `Probe.clearProfile()` or when the first probe
 * is created, in either `Probe()` or `Probe.createProbe()`. After that,
 * `_fileName` is promptly updated whenever `_profile` is changed.
 *
 * Options can be set both on `Probe()`, or on individual probes. When both
 * set, those set on an individual probe obviously takes precedent for
 * that probe. If both unset, then defaults defined here take effect.
 *
 * Available options:
 * 1. diffOnly: when a probe is fired, if watched values from the last run
 *              in the same context are available, diffs will be printed,
 *              whether to not print the new values at the same time.
 * 2. colors: whether to colorize output using ANSI color codes.
 *
 */
var _profile;
var _fileName;
var _options = {
	diffOnly: false,
	colors: true
};

// Assign user options to the specified options target.
function _assignOptions(target, options) {
	if (options instanceof Object) {
		if (options.diffOnly !== undefined) {
			target.diffOnly = !!(options.diffOnly);
		}
		if (options.colors !== undefined) {
			target.colors = !!(options.colors);
		}
	}
}

/**
 * If a name is specified, the probe will only be matched against a probe
 * with the same name in the last run. Otherwise, probes are matched by
 * their positions in the `probes[fileName][]` array, in which probes are
 * ordered by their time of creation. For example, if you don't want the
 * probe to fire when N from the previous run is reached, simply specify
 * a different name when creating it.
 *
 * There are also two types of probes: conditional and unconditional.
 * Unconditional probes only use method 1 (as described at the top) to
 * locate the offending context, while conditional probes use a combination
 * of methods 1 and 2.
 *
 * Normally the user doesn't need to explicit set the type of the probe,
 * as it's auto-detected. Initially the probe is assumed to be an unconditional
 * one and its count increments at every `watch()` call. But after the
 * first time one of the `test()`, `ptest()` and `pdone()` methods is
 * called, it's automatically converted to a conditional probe (with its
 * `count` reset to 0) and from this point on only `test()` and `pdone()`
 * calls can increment its `count` (if the conditions are met).
 *
 * @param name {string} [optional] name of the probe to create.
 * @param options {Object} [optional] per-probe options, see above for details.
 * @constructor
 */
function Probe(name, options) {
	// `name` should be a public, read-only property
	Object.defineProperty(this, 'name', {
		enumerable: true,
		writable: false,
		value: name
	});

	// Define private properties as non-enumerable, so that they don't
	// pollute the public namespace.
	var descriptor = {
		enumerable: false,
		writable: true
	};
	Object.defineProperties(this, {
		_options: descriptor,
		_count: descriptor,
		_target: descriptor,
		_isConditional: descriptor,
		_explicitType: descriptor,
		_fired: descriptor,
		_watches: descriptor,
		_presult: descriptor,
		_callsite: descriptor,
		_fileName: descriptor,
		_index: descriptor,
		_saved: descriptor
	});

	this._options = {};
	_assignOptions(this._options, options);

	// Now parse probe-specific options
	var clean;	// If true, don't try to load previously saved results. Default false.
	if (options instanceof Object) {
		// The "clean" option allows to start fresh for a specific probe,
		// without affecting other probes.
		if (options.clean !== undefined) {
			clean = !!(options.clean);
		} else {
			clean = false;
		}
	}

	this._count = 0;
	this._target = 0;
	this._isConditional = false;
	this._explicitType = false;

	this._fired = false;
	this._watches = {};

	this._presult = true;

	if (!name) {
		if (Probe.caller !== Probe.createProbe) {
			// Record information on the caller for unnamed probes.
			// However, if called from `Probe.createProbe()`, this property
			// will be assigned there.
			this._callsite = _getCallSite(2);
		}
	}

	// Initialize _fileName if not already done.
	if (_fileName === undefined) {
		_fileName = _getFileNameFromProfile(_profile, name ? null : this._callsite);
	}
	this._fileName = _fileName;

	// Add this probe to `probes`
	if (probes[this._fileName]) {
		probes[this._fileName].push(this);
		this._index = probes[this._fileName].length - 1;
	} else {
		probes[this._fileName] = [this];
		this._index = 0;
	}

	if (!clean) {
		// Load the previously saved results from this file, if existed and not
		// already loaded.
		var obj;
		if (savedProbes[this._fileName] === undefined && fs.existsSync(this._fileName)) {
			// If the filename isn't created from a specified profile name, then
			// don't load from data files not modified in the last hour, because
			// they probably belonged to the last debug session.
			if (_profile || Date.now()-fs.statSync(this._fileName).mtime.getTime() <= 3600000) {
				obj = {};
				obj.probes = JSON.parse(fs.readFileSync(this._fileName).toString());
				// Build an index for named probes.
				obj.index = {};
				for (var i = 0; i < obj.probes.length; i++) {
					if (obj.probes[i].name) {
						obj.index[obj.probes[i].name] = i;
					}
				}
				savedProbes[this._fileName] = obj;
			}
		}

		// Find this probe's save from the last run, if existed.
		obj = savedProbes[this._fileName];
		if (obj) {
			if (this.name) {
				if (obj.index[this.name] !== undefined) {
					this._saved = obj.probes[obj.index[this.name]];
				}
			} else {
				if (this._index < obj.probes.length) {
					this._saved = obj.probes[this._index];
				}
			}
		}
	}

	// Finally, expose public methods more clearly.
	this.fire = this.__proto__.fire;
	this.watch = this.__proto__.watch;
	this.test = this.__proto__.test;
	this.ptest = this.__proto__.ptest;
	this.pdone = this.__proto__.pdone;
}

/**
 * Unlike directly using the constructor, calling this method to create
 * probe instances is safe in places where execution passes many times
 * (eg, loops, event handlers), in that only one probe instance is created.
 * The instance is created in the first call, and all subsequent calls
 * return this instance instead of creating a new one.
 *
 * @param name {string} [optional]
 * @param options {Object} [optional]
 * @returns {Probe}
 */
Probe.createProbe = function(name, options) {
	// Get the CallSite object for the user's `Probe.createProbe()` call.
	var site = _getCallSite(2);

	// Initialize `_fileName` if not initialized already.
	if (_fileName === undefined) {
		_fileName = _getFileNameFromProfile(_profile, site);
	}

	var fileName = site.getFileName();
	var lineNumber = site.getLineNumber();
	var columnNumber = site.getColumnNumber();
	var key = [fileName, lineNumber, columnNumber, name, _fileName].join(':');

	if (createdProbes[key]) {
		// The probe is already created.
		return createdProbes[key];
	} else {
		// Create and index the probe.
		var probe = new Probe(name, options);

		// When called inside this function, the `Probe()` constructor
		// can't get the correct callsite object of the user call (but
		// this call here instead), and therefore `probe._callsite` holds
		// the wrong value.
		//
		// Also note that the code above to initialize `_fileName` makes
		// sure it won't be initialized in `Probe()`, thus avoiding a
		// similar problem.
		if (!name) {
			// Record information on the caller for unnamed probes.
			probe._callsite = site;
		}

		createdProbes[key] = probe;
		return probe;
	}
};

/**
 * This method sets the global options.
 *
 * @param options {Object} the options to set.
 */
Probe.setOptions = function(options) {
	_assignOptions(_options, options);
};

/**
 * This function is called by Probe()'s methods to decide whether the
 * method call at this location in this source file has already been
 * issued with these same arguments.
 *
 * This is used to make sure that Probe()'s methods can be safely called
 * in a code block where execution passes many times. We take necessary
 * steps to guarantee BOTH correctness and efficiency in such situations.
 *
 * @param arg {*} [optional] additional parts to be included in the key.
 * @returns {boolean}
 * @private
 */
function _hasCalled(arg/*, ...*/) {
	// Get the CallSite object for the user's `Probe` method call.
	var site = _getCallSite(3);

	// Build the key.
	var fileName = site.getFileName();
	var lineNumber = site.getLineNumber();
	var columnNumber = site.getColumnNumber();
	var parts = [fileName, lineNumber, columnNumber];
	parts.push.apply(parts, arguments);
	var key = parts.join(':');

	if (calledMethods[key]) {
		return true;
	} else {
		calledMethods[key] = 1;
		return false;
	}
}

/**
 * This method sets the profile name of `Probe()`, which determines the
 * filename in which probes created from this point on will store their
 * results (for use in the next run), until the profile name of `Probe()`
 * is changed again.
 *
 * The (optional) second argument specifies whether to clear any previous
 * results stored by probes created under this profile name (and start
 * fresh).
 *
 * It's not necessary to explicitly set a profile name, but setting
 * a different name to previously used names guarantees that you are
 * starting fresh. Of course, calling `Probe.clearAll()` achieves the
 * same effect.
 *
 * @param profile {string} the profile name to set to.
 * @param doClean {boolean} [optional] whether to clear the existing
 *                          file with the corresponding name. Default
 *                          is false.
 */
Probe.setProfile = function(profile, doClean) {
	// Change `_profile` or initialize `_fileName` if necessary.
	if (profile !== _profile || _fileName === undefined) {
		_profile = profile;

		// Construct filename from profile name
		_fileName = _getFileNameFromProfile(profile);
	}

	if (doClean) {
		// Calling this method in a loop doesn't cause incorrect output,
		// but we still want to avoid unnecessary disk ops.
		if (_hasCalled(profile) === false) {
			if (fs.existsSync(_fileName) && fs.statSync(_fileName).isFile()) {
				// Clear out the file's entry if it's already loaded. Setting
				// it to `false` instead of `undefined` also makes sure we
				// won't try to load it again in the process's lifetime.
				savedProbes[_fileName] = false;
				fs.unlinkSync(_fileName);
			}
		}
	}
};

/**
 * This method clears any previous results stored by probes created under
 * the specified profile name.
 *
 * If a profile name isn't specified, the current profile name of `Probe()`
 * is used.
 *
 * @param profile {string} [optional] the profile to clear.
 */
Probe.cleanProfile = function(profile) {
	// Initialize `_fileName` if not initialized already.
	if (_fileName === undefined) {
		_fileName = _getFileNameFromProfile(_profile);
	}

	// Calling this method in a loop doesn't cause incorrect output,
	// but we still want to avoid unnecessary disk ops.
	if (_hasCalled(profile || _profile) === false) {
		var fileName;
		if (profile) {
			fileName = _getFileNameFromProfile(profile);
		} else {
			fileName = _fileName;
		}

		if (fs.existsSync(fileName) && fs.statSync(fileName).isFile()) {
			// Clear out the file's entry if it's already loaded. Setting
			// it to `false` instead of `undefined` also makes sure we
			// won't try to load it again in the process's lifetime.
			savedProbes[fileName] = false;
			fs.unlinkSync(fileName);
		}
	}
};

/**
 * This method clears all previous results stored under any profile name
 * by deleting all files in the temporary directory that look like files
 * saved by us.
 */
Probe.cleanAll = function() {
	// Calling this method in a loop doesn't cause incorrect output,
	// but we still want to avoid unnecessary disk ops.
	if (_hasCalled() === false) {
		var tmpDir = os.tmpdir();
		var files = fs.readdirSync(tmpDir);
		var regExp = /^.+_probes\.json$/i;

		for (var i = 0; i < files.length; i++) {
			var fileName = path.join(tmpDir, files[i]);
			if (regExp.test(files[i]) && fs.statSync(fileName).isFile()) {
				// Clear out the file's entry if it's already loaded. Setting
				// it to `false` instead of `undefined` also makes sure we
				// won't try to load it again in the process's lifetime.
				savedProbes[fileName] = false;
				fs.unlinkSync(fileName);
			}
		}
	}
};

/**
 * This method extracts all local variables declared in the specified
 * function(s) (through analyzing their sources with acorn) and prints
 * a `watch()` statement that watches all these variables (which you
 * can copy to your source files).
 *
 * If no function is specified, the caller of this function is assumed.
 *
 * This is a helper method and a workaround for the problem that we
 * can't automatically watch all local variables because there is no
 * programmatical access to the list of local variables in JavaScript.
 *
 * @param func {Function} [optional] function to extract local vars from.
 */
Probe.printWatchStmt = function printWatchStmt(func/*, ...*/) {
	var locals;
	if (arguments.length === 0) {
		locals = ast.extractLocalVarsFromFunction(printWatchStmt.caller);
	} else {
		locals = ast.extractLocalVarsFromFunction.apply(ast, arguments);
	}

	console.log("probe.watch(" + locals.join(",") + ");");
};


Probe.prototype = {

	/**
	 * This method sets the target and optionally type of the probe. Setting
	 * the target to 0 resets it.
	 *
	 * Notes:
	 * 1. When the target is set, N from the previous run is ignored, and the
	 *    probe will only fire either when the specified target is reached,
	 *    or if `fire()` is explicitly called. Resetting the target by passing
	 *    0 in will cause N from the previous run to be used again (if it
	 *    hasn't been reached yet).
	 * 2. Calling this method after the probe is already fired has no effect,
	 *    as a fired probe is frozen.
	 * 3. This method doesn't trigger `fire()` even if the specified `target`
	 *    matches the current `count`. Additionally, in the next pass before
	 *    `count` is compared with `target`, it'd have already been incremented,
	 *    so there won't be a match ever unless you set `target` again.
	 * 4. Normally you don't need to call this method. It's named as an internal
	 *    method to discourage usage.
	 *
	 * @param target {int}
	 * @param isConditional {boolean} [optional]
	 */
	_setTargetAndType: function(target, isConditional) {
		if (this._fired === false) {
			this._target = target;
			if (isConditional !== undefined) {
				this._isConditional = isConditional;
				this._explicitType = true;
			}
		}
	},

	/**
	 * This method fires the probe. When fired, the current `count` and the
	 * current values of watched variables and expressions are both saved and
	 * printed to the console. Additionally, if there are data available
	 * from the last run in the same context (same probe, same `count` and type),
	 * also print the diff of the watched variables and expressions against
	 * their old values.
	 *
	 * Once fired, the probe is frozen and calling methods on it has no effect.
	 *
	 * This method is either called explicitly, or implicitly in two cases:
	 * 1. In `watch()` (of unconditional probes), or `test()` or `pdone()` (of
	 *    conditional probes), if the `count` is incremented and the new value
	 *    matches either the `target` (in case it's explicitly set) or the saved
	 *    count from a previous run.
	 *
	 * 2. In the process's "exit" event handler, all unfired probes are fired.
	 *
	 * In most cases, we don't need to call this method directly. It's for cases
	 * where we don't want to throw an exception or exit the process when a bug
	 * is encountered, or different probes need to be fired at different times.
	 */
	fire: function() {
		if (this._fired === false) {
			this._fired = true;

			// Check out the "diffOnly" and "colors" settings.
			var diffOnly = this._options.diffOnly === undefined
						 ? _options.diffOnly
						 : this._options.diffOnly;
			var colors = this._options.colors === undefined
					   ? _options.colors
					   : this._options.colors;

			// Format strings
			var headerStr =  ['\nProbe %s is fired on pass %s (%s, %s):',
							  '\n\x1B[91mProbe %s\x1B[0m is fired on pass \x1B[91m%s\x1B[0m (%s, %s):'];
			var infoStr =    ['i   defined in %s, Line %s',
							  '\x1B[2mi   defined in %s, Line %s\x1B[0m'];
			var changedStr = [' is changed',
							  ' is \x1B[91mchanged\x1B[0m'];
			var watchStr =   ['%s) Watch expr %s%s:',
							  '\x1B[1m%s)\x1B[0m Watch expr \x1B[1m%s\x1B[0m%s:'];
			var noWatchStr = ['*) No watch defined, nothing to print.',
							  '\x1B[2m*) No watch defined, nothing to print.\x1B[0m'];
			var idx = colors ? 1 : 0;

			// Check whether data from the last run in the same context
			// are available.
			var saved = this._saved;
			if (saved) {
				// The watch values from the previous run are only usable
				// if they were recorded in the same context.
				if (saved._count !== this._count ||
						saved._isConditional !== this._isConditional) {
					saved = null;
				}
			}

			// Now print out the watched values and/or diffs.
			console.log(headerStr[idx]
					  , this.name || this._index + 1
					  , this._count
					  , arguments[0] || 'calling fire()'
					  , this._isConditional ? 'conditional' : 'vanilla');

			if (!this.name) {
				// For unnamed probes, print a line to indicate where it was defined.
				console.log(_lineBreak(util.format(infoStr[idx]
												 , this._callsite.getFileName()
												 , this._callsite.getLineNumber())));
			}

			var keys = Object.keys(this._watches);
			if (keys.length > 0) {
				var i;
				for (i = 0; i < keys.length; i++) {
					var compareText;
					var diff = null;
					if (saved && saved._watches[keys[i]]) {
						// Watch value is available from the previous run.
						diff = _generateObjectDiff(saved._watches[keys[i]]
												 , this._watches[keys[i]]
												 , colors);
						compareText = diff.length > 0
									? changedStr[idx]
									: ' is unchanged';
					} else {
						// Watch value is not available from the previous run.
						compareText = '';
					}

					console.log(watchStr[idx], i+1, keys[i], compareText);

					if (!diff || !diffOnly) {
						// In these situations we need to print the value.
						console.log(_lineBreak('$   ' + util.inspect(this._watches[keys[i]])));
					}

					if (diff) {
						// In this situation we need to print the diff.
						if (diff.length > 0) {
							console.log(diff.join('\n'));
						}
					}
				}
			} else {
				console.log(noWatchStr[idx]);
			}
		}
	},

	/**
	 * This method updates the values of watched variables and expressions
	 * on each call, and for unconditional probes, also increments `count`
	 * and possibly fires the probe.
	 *
	 * @param expr {*} any variable or expression value.
	 */
	watch: function(expr/*, ...*/) {
		if (this._fired === false) {
			var names = _getWatchNames();
			for (var i = 0; i < arguments.length; i++) {
				this._watches[names[i]] = arguments[i];
			}

			// Update count iff this is an unconditional probe.
			if (this._isConditional === false) {
				this._count++;
				_checkCount(this);
			}
		}
	},

	/**
	 * This method is called on conditional probes and increments `count`
	 * and possibly fires the probe if the passed in condition value is
	 * truthy. If multiple condition values are passed in, they must all
	 * be truthy for the test to pass.
	 *
	 * This method can be called multiple times with same or different
	 * conditions.
	 *
	 * @param cond {*} condition value. Only cares if it's truthy or falsy.
	 */
	test: function(cond/*, ...*/) {
		if (this._fired === false) {
			// Convert the probe to conditional and reset `count` if needed.
			_testCalled(this);

			var result = true;
			for (var i = 0; i < arguments.length; i++) {
				if (!arguments[i]) {
					result = false;
				}
			}

			if (result) {
				this._count++;
				_checkCount(this);
			}

		}
	},

	/**
	 * Sometimes the conditions are complex and aren't available at the
	 * same place. For example, if the condition involves variables in
	 * several different scopes.
	 *
	 * This method, along with `pdone()`, allows the user to specify a
	 * set of conditions for a test in parts. This method can be called
	 * any number of times to add conditions before `pdone()` is called
	 * to do the test. The test only passes if all conditions specified
	 * in all `ptest()` calls are truthy.
	 *
	 * @param cond {*} condition value. Only cares if it's truthy or falsy.
	 */
	ptest: function(cond/*, ...*/) {
		if (this._fired === false) {
			// Convert the probe to conditional and reset `count` if needed.
			_testCalled(this);

			for (var i = 0; i < arguments.length; i++) {
				if (!arguments[i]) {
					this._presult = false;
				}
			}
		}
	},

	/**
	 * This method do the test based on all the `ptest()` calls before it
	 * (but after the last `pdone()` call). If no `ptest()` calls were
	 * issued in this period, the test will pass.
	 *
	 * If the test passes, this method increments `count` and possibly
	 * fires the probe.
	 */
	pdone: function() {
		if (this._fired === false) {
			// Convert the probe to conditional and reset `count` if needed.
			_testCalled(this);

			if (this._presult) {
				this._count++;
				_checkCount(this);
			}

			// Reset `_presult`.
			this._presult = true;
		}
	}
};

process.on('exit', function(code) {
	// Before exit, fire all active (unfired) probes and store all probes
	// in file.
	var files, plist, reason;
	var i, j;
	if (probes) {
		if (_options.colors) {
			console.log('\n\x1B[91mProcess is going to exit. Firing unfired probes...\x1B[0m');
		} else {
			console.log('\nProcess is going to exit. Firing unfired probes...');
		}

		if (code === 0) {
			reason = 'before exit';
		} else {
			reason = 'on uncaught exception';
		}

		files = Object.keys(probes);
		for (i = 0; i < files.length; i++) {
			plist = probes[files[i]];
			for (j = 0; j < plist.length; j++) {
				if (plist[j]._fired === false) {
					plist[j].fire(reason);
				}
			}

			// Stringify plist and write to file.
			fs.writeFileSync(files[i], JSON.stringify(plist, function(key, value) {
				if (value instanceof Object) {
					if (value._watches && value.propertyIsEnumerable('_watches')===false) {
						// This is a probe instance.
						// Only these 4 properties need to be stored in file.
						return {
							name: value.name,
							_count: value._count,
							_isConditional: value._isConditional,
							_watches: value._watches
						}
					}
				}
				return value;
			}));
		}
	}
});

Probe.annotateStackTrace = git.annotateStackTrace;
module.exports = Probe;
