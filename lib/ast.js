/**
 * This module contains functions that operate on the AST of JavaScript code.
 *
 * Author: Feng Qiu <feng@ban90.com>
 * Date: 13-7-25
 */

var acorn = require('acorn');

module.exports = {
	/**
	 * This function extracts local variables from the given function(s) and
	 * returns them in an array. The implementation is based on acorn.
	 *
	 * Multiple functions can be passed in, and their local variable names
	 * will be returned in a single array, without trying to remove duplicates.
	 *
	 * @param func {Function} the function to extract local vars from.
	 * @returns {Array} the local variable names extracted.
	 */
	extractLocalVarsFromFunction: function(func/*,...*/) {
		var ast;
		var localVars = [];
		var inFunc;

		// Traverse the AST and look for variable declarations.
		function traverse(node) {
			var dnode, ditem;
			var i;

			if (node.type === 'FunctionDeclaration') {
				if (inFunc) {
					// We are already inside the target function's node.
					// Stop here as we don't need local variables of nested
					// functions inside the target function.
					return
				} else {
					// This is the target function's node, continue processing
					// its children, but don't enter any other function nodes
					// in the future.
					inFunc = true;
				}
			} else if (node.type === 'ForStatement') {
				// There may be variable declarations in its `init` section.
				if (node.init && node.init.type === 'VariableDeclaration') {
					dnode = node.init;
				}
			} else if (node.type === 'VariableDeclaration') {
				dnode = node;
			}

			// Extract variable declarations from the declaration node.
			if (dnode) {
				for (i = 0; i < dnode.declarations.length; i++) {
					ditem = dnode.declarations[i];
					if (ditem.type === 'VariableDeclarator') {
						localVars.push(ditem.id.name);
					}
				}
			}

			// Process its children if any.
			if (node.body instanceof Array) {
				for (i = 0; i < node.body.length; i++) {
					traverse(node.body[i]);
				}
			} else if (node.body) {
				traverse(node.body);
			}
		}

		// Let acorn parse the functions' texts and get their AST's one by one.
		for (var i = 0; i < arguments.length; i++) {
			ast = acorn.parse(arguments[i].toString());
			if (ast) {
				inFunc = false;
				traverse(ast);
			}
		}

		return localVars;
	}
};
