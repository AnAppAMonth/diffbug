DiffBug - Automated Debugging for Node.js
=========================================

This module implements the Probe class, which helps us in debugging to
locate the offending context, print out watched variables, and compare
their values to those recorded in the same context in a good run.

Background
----------

Debugging is the process of repeatedly searching for the next offending
context. A context is a specific execution pass over a block of code,
and an offending context is a context in which wrong results are either
generated or propagated, eg, a variable holds a wrong value. You may
use an interactive debugger, or simply `console.log()`, either way, to
examine an offending context, you have to first reach it, ie, identify
the offending block of code, and the exact pass over it. In many cases,
the execution passes a block of code thousands of times, but only a few
of them involve wrong results.

The search normally starts with either an uncaught exception, or an error
visible to the user, eg, the generated HTML page is wrong. In the former
case, you can use the debugger's "Break on Exception" feature to quickly
locate the offending context; in the latter, the first offending context
is simply the code block that generates the HTML.

However, only in the most fortunate cases are the true error located at
the same place as where it's *discovered*. So in most cases you then need
to locate the next offending context (or in execution order, the previous),
which caused the problem we observe. Debugging is then the process of
following the error-propagation chain backwards and examining one offending
context after another, until you find the true source of the error.

At each step in the process, you have to first identify the code block
of an offending context, and then figure out a way to arrive at the exact
execution pass over it. The latter is often the more difficult of the two,
especially in an event-driven, asynchronous environment like Node.

Two methods are commonly used to achieve this:
- Count the number of times execution passes the code block before the
  error occurs, say N, then in the next run skip the first N-1 passes,
  and break or print at pass N.
- Find a set of conditions that are only met in the offending pass, and
  break or print on these conditions.

On the other hand, with the help of VCS software, there is one particularly
effective workflow for debugging: when you discover a bug, first locate
the commit in which it's introduced (possibly with the help of the VCS's
bisect command), and then compare it with its parent (the last good commit).
If your commits are frequent and fine-grainded enough, then it shouldn't
be too hard to find the offending change.

The Probe class makes it exetremely easy to use a combination of the above
two methods to reach the offending context, print out interesting variable
values, and optionally compare them against those recorded in the same
context in a good run.

Usage
-----

The intended workflow is as follows:

1. Check out the offending commit.
2. Create a probe and `watch()` a few variables. If you only need to use
   the method 1 above, you are done; otherwise you can call `test()` on
   a set of conditions (and utilize both methods 1 and 2).
3. Run. When the exception is thrown and the program exits, the watched
   variable values are printed to the console, and these values, along
   with the N, are stored in a temporary file.
4. Stash your changes in 2, check out the last good commit, and apply the
   changes above it, resolving any conflicts.
5. Run. This module will read from the temporary file created in step 3
   to fetch data from the previous run. Now when pass N is reached, the
   probe is fired automatically and the watched variable values, along
   with diffs against their values in the last run (step 3), are printed
   to the console. The temporary file is also updated with the new data.
6. Optionally, you can check out the offending commit and do step 5 again,
   this time diff'ing variable values in the offending commit against
   the good commit (maybe adding variables to watch at the same time).
   And you can do this back and forth, as many times as you like.
7. Repeat these steps for the next offending context, until you find the
   true source of the error.

In case your error doesn't cause an uncaught exception to end the process
immediately, you can either call `fire()` manually when the error occurs,
or call `process.exit()` to exit the process, in which case `fire()` will
automatically be called in the `exit` event handler of `process`.
