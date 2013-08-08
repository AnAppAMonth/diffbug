/**
 * Copyright (c) 2012, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 *
 * Adapted from the Istanbul project (https://github.com/gotwarlost/istanbul).
 * By Feng Qiu <feng@ban90.com>
 */

var util = require('util'),
    path = require('path'),
    fs = require('fs');

function Factory(kind, dir, allowAbbreviations) {
    this.kind = kind;
    this.dir = dir;
    this.allowAbbreviations = allowAbbreviations;
    this.classMap = {};
}

Factory.prototype = {

    knownTypes: function () {
        var keys = Object.keys(this.classMap);
        keys.sort();
        return keys;
    },

    resolve: function (abbreviatedType) {
        // Resolve the abbreviated type against an array of types.
        // We don't use the `abbrev` module because:
        // 1. Requiring a module takes time.
        // 2. This function is typically only called once in a program run, so
        //    generating a data structure for this task doesn't make sense.
        // 3. `abbrev` lacks functionality we need. For example, when an ambiguous
        //    abbreviation is used, it doesn't tell the user which commands have
        //    this prefix.
        // 4. This functionality is simple enough to implement anyway.
        var types = Object.keys(this.classMap),
            matches = [];
        
        for (var i = 0; i < types.length; i++) {
            var targetType = types[i],
                abbrevLen = abbreviatedType.length;

            if (targetType.substring(0, abbrevLen) === abbreviatedType) {
                // `abbreviatedType` is a prefix of `targetType`
                if (abbrevLen === targetType.length) {
                    // This is an exact match, searching is over
                    return targetType;
                } else {
                    // Record this match
                    matches.push(targetType);
                }
            }
        }
        
        if (matches.length === 0) {
            // There isn't a match
            return undefined;
        } else if (matches.length === 1) {
            // There is only one match
            return matches[0];
        } else {
            // There are multiple matches
            return matches;
        }
    },

    register: function (constructor) {
        var type = constructor.TYPE;
        if (!type) { throw new Error('Could not register ' + this.kind + ' constructor [no TYPE property]: ' + util.inspect(constructor)); }
        this.classMap[type] = constructor;
    },

    create: function (type, opts) {
        var realType = this.allowAbbreviations ? this.resolve(type) : type,
            Cons;

        if (typeof realType === 'string') {
            Cons = this.classMap[realType];
            if (Cons) {
                return new Cons(opts);
            }
        }

        if (realType instanceof Array) {
            // There are multiple matches
            throw new Error('Ambiguous ' + this.kind + ' [' + type + '], did you mean:\n ' + realType.join('\n '));
        } else {
            // There isn't a match
            throw new Error('Invalid ' + this.kind + ' [' + type + '], allowed values are ' + this.knownTypes().join(', '));
        }
    },

    loadStandard: function (dir) {
        var that = this;
        fs.readdirSync(dir).forEach(function (file) {
            if (file !== 'index.js' && file.indexOf('.js') === file.length - 3) {
                try {
                    that.register(require(path.resolve(dir, file)));
                } catch (ex) {
                    console.error(ex.message);
                    console.error(ex.stack);
                    throw new Error('Could not register ' + that.kind + ' from file ' + file);
                }
            }
        });
    },

    bindClassMethods: function (Cons) {
        var tmpKind = this.kind.charAt(0).toUpperCase() + this.kind.substring(1); //ucfirst

        Cons.mix = Factory.mix;
        Cons.register = this.register.bind(this);
        Cons.create = this.create.bind(this);
        Cons.loadAll = this.loadStandard.bind(this, this.dir);
        Cons['get' + tmpKind + 'List'] = this.knownTypes.bind(this);
    }
};

Factory.mix = function (cons, proto) {
    Object.keys(proto).forEach(function (key) {
        cons.prototype[key] = proto[key];
    });
};

module.exports = Factory;
