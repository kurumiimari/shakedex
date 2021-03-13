const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { startRegtest, stopRegtest } = require('./hsd.js');

chai.use(chaiAsPromised);

before(async () => {
  await startRegtest();
});

after(async () => {
  await stopRegtest();
});
