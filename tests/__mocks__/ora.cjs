// CommonJS stub for ora@8 (ESM-only) to allow Jest tests to run in CJS mode.
'use strict';

function createSpinner() {
  return {
    start: () => createSpinner(),
    stop: () => createSpinner(),
    succeed: () => createSpinner(),
    fail: () => createSpinner(),
    warn: () => createSpinner(),
    info: () => createSpinner(),
    text: '',
  };
}

module.exports = function ora() {
  return createSpinner();
};
module.exports.default = module.exports;
