/**
 * Copyright (c) 2012, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 *
 * Adapted from the Istanbul project (https://github.com/gotwarlost/istanbul).
 * By Feng Qiu <feng@ban90.com>
 */

var Store = require('./store'),
    Vcs = require('./vcs'),
    Command = require('./command');

Store.loadAll();
Vcs.loadAll();
Command.loadAll();
