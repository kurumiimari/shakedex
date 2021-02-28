const assertModule = require('assert');
const Address = require('hsd/lib/primitives/address.js');
const Coin = require('hsd/lib/primitives/coin.js');
const { format } = require('date-fns');

const assert = assertModule.strict;

exports.coerceBuffer = function (input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  assert(typeof input === 'string');
  return Buffer.from(input, 'hex');
};

exports.coerceAddress = function (input) {
  if (input instanceof Address) {
    return input;
  }

  return new Address().fromString(input);
};

exports.coerceCoin = function (input) {
  if (input instanceof Coin) {
    return input;
  }

  return new Coin().fromJSON(input);
};

exports.formatDate = function (ts) {
  return format(new Date(ts), 'yyyy-MM-dd hh:mm:ss');
};
