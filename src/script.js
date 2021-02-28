const Opcode = require('hsd/lib/script/opcode.js');
const rules = require('hsd/lib/covenants/rules.js');
const Script = require('hsd/lib/script/script.js');

exports.createLockScript = function (pubKey) {
  return new Script([
    Opcode.fromSymbol('type'),
    Opcode.fromInt(rules.types.TRANSFER),
    Opcode.fromSymbol('equal'),

    Opcode.fromSymbol('if'),
    Opcode.fromPush(pubKey),
    Opcode.fromSymbol('checksig'),
    Opcode.fromSymbol('else'),
    Opcode.fromSymbol('type'),
    Opcode.fromInt(rules.types.FINALIZE),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('endif'),
  ]);
};
