const assertModule = require('assert');
const Address = require('hsd/lib/primitives/address.js');
const { format } = require('date-fns');

const assert = assertModule.strict;

exports.coerceBuffer = function(input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  assert(typeof input === 'string');
  return Buffer.from(input, 'hex');
}

exports.coerceAddress = function(input) {
  if (input instanceof Address) {
    return input;
  }

  return new Address().fromString(input);
}

exports.formatDate = function(ts) {
  return format(new Date(ts), 'yyyy-MM-dd hh:mm:ss')
}