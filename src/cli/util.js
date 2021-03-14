exports.die = function die(msg) {
  console.log(msg);
  process.exit(1);
}

exports.log = function log(msg) {
  console.log(`>> ${msg}`);
}