const Opcode = require('hsd/lib/script/opcode.js');
const rules = require('hsd/lib/covenants/rules.js');
const Script = require('hsd/lib/script/script.js');

exports.createLockScript = function(
  pubKey,
) {
  return new Script([
    Opcode.fromSymbol('type'),
    Opcode.fromInt(rules.types.UPDATE),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('if'),
    Opcode.fromSymbol('return'),
    Opcode.fromSymbol('endif'),

    Opcode.fromSymbol('type'),
    Opcode.fromInt(rules.types.REVOKE),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('if'),
    Opcode.fromSymbol('return'),
    Opcode.fromSymbol('endif'),

    Opcode.fromSymbol('type'),
    Opcode.fromInt(rules.types.RENEW),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('if'),
    Opcode.fromSymbol('return'),
    Opcode.fromSymbol('endif'),

    Opcode.fromSymbol('type'),
    Opcode.fromInt(rules.types.TRANSFER),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('if'),
    Opcode.fromPush(pubKey),
    Opcode.fromSymbol('checksigverify'),
    Opcode.fromSymbol('endif'),
    Opcode.fromInt(1),
  ]);
}