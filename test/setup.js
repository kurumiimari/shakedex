const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { startRegtest, stopRegtest } = require('./hsd.js');

chai.use(chaiAsPromised);

before(async () => {
  console.log('Starting HSD.');
  await startRegtest();
});

after(async () => {
  console.log('Stopping HSD.');
  await stopRegtest();
});
