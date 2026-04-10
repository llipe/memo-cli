// CommonJS stub for chalk@5 (ESM-only) to allow Jest tests to run in CJS mode.
// All chalk methods return the input string unchanged.
'use strict';

function createChalk() {
  const fn = function (...args) {
    return args.join(' ');
  };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'level') return 0;
      return createChalk();
    },
    apply(_target, _thisArg, args) {
      return args.join(' ');
    },
  });
}

const chalk = createChalk();
module.exports = chalk;
module.exports.default = chalk;
