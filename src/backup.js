const tar = require('tar');
const path = require('path');

exports.backupDb = function (dbPath, outFile) {
  return tar.c(
    {
      gzip: true,
      file: outFile,
      cwd: path.dirname(dbPath),
    },
    [path.basename(dbPath)]
  );
};
