/**
 * This module contains functions that utilize Git to help with our development.
 *
 * Obviously this module only works on the command line, so we implement it as
 * a Node module, rather than an AMD module.
 *
 * Author: Feng Qiu <feng@ban90.com>
 * Date: 13-7-21
 */

var child_process = require('child_process');
var path = require('path');
var fs = require('fs');
var util = require('util');

function trim(s) {
	return s.replace(/^\s+|\s+$/g, '');
}

/**
 * Stack traces are not as useful to debugging as they can be. The biggest
 * problem is that they only provide line numbers, and the developers have
 * to manually check out what these lines are, and which of them were
 * changed recently and possibly caused this bug. In the end they have to
 * constantly switch between the IDE, the VCS, and the console to integrate
 * relevant info.
 *
 * This function takes a Node.js `Error` object, and prints its stack trace
 * "annotated" with code lines surrounding each callsite, complete with
 * information on which lines are changed in the most recent commit.
 *
 * The intended usage pattern is to first locate the offending commit using
 * git-bisect, and then use this function to help find the bug. Therefore,
 * this function assumes that the current HEAD is the offending commit, and
 * its parent (HEAD~1) is healthy. The printed diffs are between HEAD~1 and
 * the current working directory.
 *
 * The arguments `libLC`, `cleanLC`, `dirtyLC` and `maxLC` specify how many
 * lines of code to display before and after the target line (the line that
 * appears in the stack trace), in various situations. For a file that is
 * changed by HEAD and a target line in it, we first check if a diff hunk
 * is less than `dirtyLC` lines away. If not, `cleanLC` lines are displayed
 * at each side of the target line. Otherwise, it depends on whether the
 * entire hunk is contained in `dirtyLC` lines from the target line. If so,
 * then `dirtyLC` lines are displayed, otherwise, we try to include the
 * entire hunk, but at most display `maxLC` lines.
 *
 * NOTE that the `Error` object passed in MUST NOT have accessed its `stack`
 * property, because this function replaces `Error.prepareStackTrace()` to
 * get the `Error` object's structured stack trace (which is an array of
 * `CallSite` objects and saves us from dirty string parsing). This only
 * works before the object's `stack` property is first accessed. After
 * calling this function, its `stack` property can be used as normal.
 * For more info on V8's structured stack traces and the associated API,
 * see http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi.
 *
 * @param error {Object} an `Error` object whose `stack` property hasn't
 *                       been accessed yet.
 * @param maxSites {int} maximum number of callsites to annotate. The remaining
 *                       ones will be displayed like in normal stack traces.
 * @param libLC {int} LC for library (non-user) files.
 * @param cleanLC {int} LC for target lines far away (more than `dirtyLC`
 *                      lines away) from all hunks.
 * @param dirtyLC {int} minimum LC for target lines close to a hunk.
 * @param maxLC {int} maximum LC for target lines close to a hunk.
 * @param tabWidth {int} if >0, tabs in code lines are replaced with these
 *                       many spaces before being printed; otherwise ignored.
 * @param callback {Function}
 */
function annotateStackTrace(error, maxSites, libLC, cleanLC, dirtyLC, maxLC, tabWidth, callback) {
	var stack, callsites;

	// Check the arguments.
	if (dirtyLC > maxLC) {
		callback(new Error("Illegal arguments: maxLC smaller than dirtyLC"), null);
		return;
	}
	if (cleanLC > dirtyLC) {
		callback(new Error("Illegal arguments: dirtyLC smaller than cleanLC"), null);
		return;
	}

	var orig = Error.prepareStackTrace;
	Error.prepareStackTrace = function(error, structuredStackTrace) {
		callsites = structuredStackTrace;
		Error.prepareStackTrace = orig;
		return error.stack;
	};
	stack = error.stack;

	// If callsites is undefined, it means error.stack has already been
	// accessed before this function is called.
	if (callsites === undefined) {
		// Since our custom prepareStackTrace() function isn't called,
		// Error.prepareStackTrace hasn't been reset to its original value.
		Error.prepareStackTrace = orig;
		callback(new Error("The error object's stack property accessed before calling annotateStackTrace()"), null);
		return;
	}

	// First get the top level absolute path of the repository, to simplify
	// paths in the diff. We can also find out whether we are in fact under
	// a Git repository or not.
	child_process.exec('git rev-parse --show-toplevel', function(err, stdout/*, stderr*/) {
		// An error will occur if we are not under a Git repository.
		if (err) {
			callback(err, null);
			return;
		}

		var gitDir = trim(stdout);

		// Do a git-diff between HEAD~1 and the working directory and parse
		// the result.
		child_process.exec('git --no-pager diff -U0 HEAD~1', function(err, stdout/*, stderr*/) {
			if (err) {
				callback(err, null);
				return;
			}

			// Now parse the diff output to get the changed lines
			//noinspection UnnecessaryLocalVariableJS
			var diff = stdout;
			// Dictionary. Key: filename in the diff. Value: an array of
			// 3-element arrays ([newStartLine, newEndLine, [hunk lines]]),
			// each representing a hunk.
			var diffCache = {};
			// Dictionary. Key: filename in callsites. Value: an array storing
			// lines in the file. The diff doesn't necessarily contain all the
			// code lines we need for the annotation, so we need this cache.
			var fileCache = {};
			var newFileName, newStartLine, newLineCount;
			// Note that diff sections without the "b" part, in other words,
			// the old file is deleted, are ignored.
			var regExpFileHeading = /^--- .*\n^\+\+\+ b\/(.+)\n/gm;
			var regExpHunkHeading = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@.*\n/gm;
			var files, fileText, hunks, hunkText, lines;
			var i, j, k, n;

			// First parse file sections in the diff
			files = diff.split(regExpFileHeading);
			for (i = 1; i < files.length; i += 2) {
				newFileName = files[i];
				fileText = files[i + 1];

				diffCache[newFileName] = [];
				// Then parse hunks in each file section
				hunks = fileText.split(regExpHunkHeading);
				for (j = 1; j < hunks.length; j += 3) {
					newStartLine = parseInt(hunks[j]);
					if (hunks[j + 1] !== undefined) {
						newLineCount = parseInt(hunks[j + 1]);
					} else {
						newLineCount = 1;
					}
					hunkText = hunks[j + 2];

					// Finally parse changed lines in each hunk
					lines = hunkText.split('\n');
					k = 0;
					while (lines[k][0] === '+' || lines[k][0] === '-') {
						k++;
					}
					// The first k lines are the hunk
					lines.length = k;

					diffCache[newFileName].push([newStartLine, newStartLine + newLineCount - 1, lines]);
				}
			}

			// Second, for each file in a relevant callsite, we need to fetch
			// the needed lines from that file.
			var result = [];
//			var consoleColumns = process.stdout.columns;
//			var sep = new Array(consoleColumns + 1).join('=');
			var site, trace;
			var fileName, typeName, funcName, methodName, lineNum, colNum;
			var callName, relativeFileName, displayFileName;
			var lc;
			var startHunk, endHunk;
			var fileContent, startLine, endLine, lineCount;
			var line, tabRepl;
			if (tabWidth > 0) {
				tabRepl = new Array(tabWidth + 1).join(' ');
			}

			var colors = ['101;30', '102;30', '103;30', '104;30', '105;30', '106;30',
							'41;97', '42;97', '43;97', '44;97', '45;97', '46;97'];
			var colors2 = ['91','92','93','94','95','96', '31','32','33','34','35','36'];
			var fileColor = {};
			var currColor = 0;

			for (i = 0; i < callsites.length; i++) {
				site = callsites[i];
				fileName = site.getFileName();
				funcName = site.getFunctionName();
				methodName = site.getMethodName();
				if (methodName) {
					typeName = site.getTypeName();
				} else {
					typeName = null;
				}
				lineNum = site.getLineNumber();
				colNum = site.getColumnNumber();

				// Here we try to mimic Node's formatting of the stack traces
				callName = funcName || methodName;
				if (callName && typeName) {
					callName = typeName + '.' + callName;
				}

				// Calculate the relative path to the Git root.
				relativeFileName = path.relative(gitDir, fileName);
				if (relativeFileName[0] === '.') {
					displayFileName = fileName;
				} else {
					// Display relative file name for files under Git root.
					displayFileName = relativeFileName;
				}

				// Get color for this file.
				if (fileColor[fileName] === undefined) {
					fileColor[fileName] = currColor;
					currColor++;
					if (currColor >= colors.length) {
						// Number of files exceeds the number of available colors,
						// we have to reuse the used ones.
						currColor = 0;
					}
				}

				trace = util.format('\x1B[1m%s ->\x1B[21;%sm%s\x1B[49;90m in \x1B[%sm%s\x1B[0m (\x1B[1m%d:%d\x1B[0m)'
									, i + 1
									, colors[fileColor[fileName]]
									, callName || 'anonymous'
									, colors2[fileColor[fileName]]
									, displayFileName
									, lineNum
									, colNum);

				// Add seperator to the result for this entry.
				result.push('');
//				result.push(sep);
				result.push(trace);
				result.push('');

				if (i >= maxSites) {
					continue;
				}

				// If fileName doesn't start with '/', then it must be internal
				// code of Node, and we simply ignore it.
				if (fileName[0] === '/') {
					// Make sure we have the content of this file.
					if (fileCache[fileName] === undefined) {
						fileCache[fileName] = fs.readFileSync(fileName).toString().split('\n');
					}
					fileContent = fileCache[fileName];

					if (relativeFileName[0] === '.') {
						// The file is outside of the Git root, we take it as
						// a library file.
						lc = libLC;

					} else if (diffCache[relativeFileName]) {
						// This file is changed against HEAD~1.
						// First we need to find the set of diff hunks that are
						// close to this line.
						hunks = diffCache[relativeFileName];
						for (startHunk = 0; startHunk < hunks.length; startHunk++) {
							if (hunks[startHunk][1] >= lineNum - dirtyLC) {
								break;
							}
						}
						if (startHunk < hunks.length) {
							for (endHunk = startHunk; endHunk < hunks.length; endHunk++) {
								if (hunks[endHunk][0] > lineNum + dirtyLC) {
									break;
								}
							}
							endHunk--;

							if (startHunk <= endHunk) {
								// Hunks from startHunk to endHunk are close enough.
								// Note that we didn't consider deleted lines (which
								// are not in the (new) file but are in the diff) when
								// calculating which hunks are close enough. So these
								// are just candidates and may not make it into our
								// annotations due to limits on surrounding lines.

								// An array of sections. Each section is either a
								// file section (which contains a line range from
								// `fileContent`), or a hunk section (which contains
								// a line range from a hunk). Only hunks from `startHunk`
								// to `endHunk` are included, and holes between them
								// are supplemented with file sections.
								//
								// Additionally, the section that contains the target
								// line is divided into three sections: the part before
								// the target line, the target line, and the part after
								// the target line.
								//
								// Each section is represented by a 3-element array:
								// [[lines], startLine, lineCount].
								var sections = [];
								// Index of the section that contains the target line
								// in `sections`.
								var targetIndex;
								// The first and last entry in `sections` that should
								// be included into the result.
								var startIndex, endIndex;

								// Note that all line numbers (`startLine`, `endLine`,
								// `lineNum`) start with 1; while all array indexes
								// (`startIndex`, `endIndex`, `targetIndex`) start
								// with 0.

								// Build the `sections` array. Some sections may have
								// 0 length, they will simply be ignored later.
								//
								// Note that we make one more pass through the loop
								// to add the last file section.
								for (j = startHunk; j <= endHunk + 1; j++) {
									// Add the file section before this hunk
									if (j === startHunk) {
										// This is the first hunk.
										startLine = 1;
										lineCount = hunks[j][0] - 1;
									} else if (j === endHunk + 1) {
										// This is the last pass, used to add this
										// last file section.
										startLine = hunks[j - 1][1] + 1;
										lineCount = fileContent.length + 1 - startLine;
									} else {
										startLine = hunks[j - 1][1] + 1;
										lineCount = hunks[j][0] - startLine;
									}

									if (lineCount > 0) {
										if (startLine <= lineNum && startLine + lineCount > lineNum) {
											// This section contains the target line and
											// should be splitted.
											sections.push([fileContent, startLine, lineNum - startLine]);
											sections.push([fileContent, lineNum, 1]);
											targetIndex = sections.length - 1;
											sections.push([fileContent, lineNum + 1, startLine + lineCount - lineNum - 1]);
										} else {
											sections.push([fileContent, startLine, lineCount]);
										}
									}

									if (j <= endHunk) {
										// Add the hunk section for this hunk
										lines = hunks[j][2];
										if (hunks[j][0] <= lineNum && hunks[j][1] >= lineNum) {
											// This section contains the target line and should
											// be splitted.
											k = lineNum - hunks[j][0];
											// Calculate which line in the hunk corresponds to
											// the target line in the file.
											n = 0;
											while(1) {
												if (lines[n][0] !== '-') {
													k--;
													if (k < 0) {
														break;
													}
												}
												n++;
											}
											sections.push([lines, 1, n]);
											sections.push([lines, n + 1, 1]);
											targetIndex = sections.length - 1;
											sections.push([lines, n + 2, lines.length - n - 1]);

										} else {
											sections.push([lines, 1, lines.length]);
										}
									}
								}

								// Calculate `startIndex`
								n = 0;
								startIndex = 0;
								for (j = targetIndex - 1; j >= 0; j--) {
									n += sections[j][2];
									if (n >= dirtyLC) {
										if (sections[j][0] === fileContent) {
											// This is a file section.
											if (j === targetIndex - 1) {
												// There isn't a hunk before the target line
												// that's close.
												sections[j][1] += n - cleanLC;
												sections[j][2] = cleanLC;
											} else {
												sections[j][1] += n - dirtyLC;
												sections[j][2] -= n - dirtyLC;
											}
										} else {
											// This is a hunk section.
											if (n > maxLC) {
												sections[j][1] += n - maxLC;
												sections[j][2] -= n - maxLC;
											}
										}
										startIndex = j;
										break;
									}
								}

								// Calculate `endIndex`
								n = 0;
								endIndex = sections.length - 1;
								for (j = targetIndex + 1; j < sections.length; j++) {
									n += sections[j][2];
									if (n >= dirtyLC) {
										if (sections[j][0] === fileContent) {
											// This is a file section.
											if (j === targetIndex + 1) {
												// There isn't a hunk after the target line
												// that's close.
												sections[j][2] = cleanLC;
											} else {
												sections[j][2] -= n - dirtyLC;
											}
										} else {
											// This is a hunk section.
											if (n > maxLC) {
												sections[j][2] -= n - maxLC;
											}
										}
										endIndex = j;
										break;
									}
								}

								// Finally print the lines in `sections` between
								// `startIndex` and `endIndex`
								for (j = startIndex; j <= endIndex; j++) {
									var isFileSection = sections[j][0] === fileContent;
									for (k = sections[j][1] - 1; k < sections[j][1] + sections[j][2] - 1; k++) {
										line = sections[j][0][k];
										if (tabWidth > 0) {
											line = line.replace(/\t/g, tabRepl);
										}
										if (isFileSection) {
											// This is required to make sure the line aligns
											// well with lines from diff hunks.
											line = ' ' + line;
										} else {
											// Colorize diff lines.
											if (line[0] === '+') {
												line = '\x1B[32m' + line + '\x1B[0m';
											} else if (line[0] === '-') {
												line = '\x1B[31m' + line + '\x1B[0m';
											}
										}
										// Bold the target line
										if (j === targetIndex) {
											line = '\x1B[1m' + line + '\x1B[0m';
										}
										result.push(line);
									}
								}

								continue;

							} else {
								// There isn't a matching hunk
								lc = cleanLC;
							}
						} else {
							// There isn't a matching hunk
							lc = cleanLC;
						}


					} else if (relativeFileName.indexOf('/node_modules/') >= 0) {
						// This file is under a "node_modules" directory and
						// isn't changed, we take it as a library file.
						lc = libLC;

					} else {
						// A normal unchanged source file.
						lc = cleanLC;
					}

					startLine = lineNum - lc;
					endLine = lineNum + lc;
					if (startLine < 1) {
						startLine = 1;
					}
					if (endLine > fileContent.length) {
						endLine = fileContent.length;
					}
					for (j = startLine; j <= endLine; j++) {
						line = fileContent[j - 1];
						if (tabWidth > 0) {
							line = line.replace(/\t/g, tabRepl);
						}
						// Bold the target line
						if (j === lineNum) {
							line = '\x1B[1m' + line + '\x1B[0m';
						}
						result.push(line);
					}
				}
			}

			callback(null, result.join('\n'));
		});
	})
}

module.exports = {
	annotateStackTrace: annotateStackTrace
};
