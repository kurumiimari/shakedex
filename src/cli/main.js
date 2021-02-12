const {program} = require('commander');
const pkg = require('../../package.json');
const {transferNameLock} = require('../swapService.js');
const {Context, promptPassphraseGetter} = require('../context.js');
const {createDB, putLockTransfer} = require('../storage.js');
const Table = require('cli-table');
const {putLockFinalize} = require('../storage.js');
const {finalizeNameLock} = require('../swapService.js');
const {getName} = require('../storage.js');
const {getNames} = require('../storage.js');
const inquirer = require('inquirer');
const fs = require('fs');
const {putAuction} = require('../storage.js');
const {linearReductionStrategy} = require('../auction.js');
const {Auction} = require('../auction.js');
const readline = require('readline');
const {readProofFile} = require('../swapProof.js');
const {writeProofFile} = require('../swapProof.js');
const {putSwapFinalize} = require('../storage.js');
const {finalizeSwap} = require('../swapService.js');
const {formatDate} = require('../conversions.js');
const {putSwapFulfillment} = require('../storage.js');
const {fulfillSwap} = require('../swapService.js');
const {SwapProof} = require('../swapProof.js');


program
  .version(pkg.version)
  .option('-p, --prefix <prefix>', 'Prefix directory to write the database to.', `${process.env.HOME}/.shakedex`)
  .option('-n, --network <network>', 'Handshake network to connect to.', 'regtest')
  .option('-w, --wallet-id <walletId>', 'Handshake wallet ID.', 'primary')
  .option('-a, --api-key <apiKey>', 'Handshake wallet API key.');

program.command('transfer-lock <name>')
  .description('Posts a name lock transaction, which when finalized allows the name to be auctioned.')
  .action(cliSetup(transferLock));

program.command('finalize-lock <name>')
  .description('Finalizes a name lock transaction, which allows the name to be auctioned.')
  .action(cliSetup(finalizeLock));

program.command('create-auction <name>')
  .description('Creates auction presigns.')
  .action(cliSetup(createAuction));

program.command('list-auctions')
  .description('Prints all name auctions and their statuses.')
  .action(cliSetup(listAuctions));

program.command('fulfill-auction <proposalsPath>')
  .description('Fulfills an auction given a set of presigns.')
  .action(cliSetup(fulfillAuction));

program.command('finalize-auction <name>')
  .description('Finalizes an auction that has been previously fulfilled.')
  .action(cliSetup(finalizeAuction));

program.command('list-fulfillments')
  .description('Prints the list of auctions that you have attempted to fulfill.')
  .action(cliSetup(listFulfillments));

program.parse(process.argv);

function cliSetup(fn) {
  return async (...args) => {
    try {
      setupPrefix();
      await fn(...args);
    } catch (e) {
      console.error('An error occurred. Stack trace:');
      console.error(e);
      console.error();
      console.error(`Please report this as an issue by visiting ${pkg.bugs.url}/new.`);
    }
  };
}

async function confirm(message) {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
    },
  ]);

  if (!answers.confirmed) {
    die('Cancelled.');
  }
}

function setupPrefix() {
  const opts = program.opts();
  if (fs.existsSync(opts.prefix)) {
    return;
  }
  fs.mkdirSync(opts.prefix);
}

function getContext() {
  const opts = program.opts();
  return new Context(
    opts.network,
    opts.walletId,
    opts.apiKey,
    promptPassphraseGetter(),
  );
}

async function transferLock(name) {
  await confirm(`Your name ${name} will be transferred to a locking script. ` +
    'This can be undone, but requires additional on-chain transactions. Do you wish to continue?');

  const db = await createDB(program.opts().prefix);
  const context = getContext();

  log('Performing locking script transfer.');
  const lockTransfer = await transferNameLock(
    context,
    name,
  );
  await putLockTransfer(db, lockTransfer);
  log(`Name transferred to locking script with transaction hash ${lockTransfer.transferTxHash}.`);
  log('Please wait at least 15 minutes for your transaction to be confirmed.');
}

async function finalizeLock(name) {
  await confirm(`Your transfer of ${name} to the locking script will be finalized. ` +
    'This can be undone, but requires additional on-chain transactions. Do you wish to continue?');

  const db = await createDB(program.opts().prefix);
  const context = getContext();
  const nameObj = await getName(db, name);

  if (!nameObj) {
    die(`Name ${name} does not exist.`);
  }

  log('Finalizing locking script transfer.');
  const lockFinalize = await finalizeNameLock(
    context,
    nameObj.transfer,
  );
  await putLockFinalize(db, lockFinalize);
  log(`Name finalized to locking script with transaction hash ${lockFinalize.finalizeTxHash}.`);
  log('Please wait at least 15 minutes for your transaction to be confirmed.');
}

async function createAuction(name) {
  const db = await createDB(program.opts().prefix);
  const context = getContext();
  const nameObj = await getName(db, name);

  if (!nameObj) {
    die(`Name ${name} does not exist.`);
  }

  if (!nameObj.finalize) {
    die(`Name ${name}'s listing has not been finalized.`);
  }

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'duration',
      message: 'How long should the auction last?',
      choices: [
        '1 day',
        '3 days',
        '5 days',
        '7 days',
        '14 days',
      ],
    },
    {
      type: 'input',
      name: 'startPrice',
      message: 'What price would you like to start the auction at? This should be a high price. Expressed in whole HNS.',
      validate: (value) => {
        const valid = !isNaN(Number(value)) && Number(value) > 0;
        if (valid) {
          return true;
        }
        return `Invalid start price.`;
      },
    },
    {
      type: 'input',
      name: 'endPrice',
      message: 'What price would you like to end the auction at? This is the lowest price you will accept for the name. Expressed in whole HNS.',
      validate: (value) => {
        const valid = !isNaN(Number(value)) && Number(value) > 0;
        if (valid) {
          return true;
        }
        return `Invalid end price.`;
      },
    },
    {
      type: 'input',
      name: 'outPath',
      message: 'Where would you like to store your auction presigns?',
    },
  ]);

  const durationDays = Number(answers.duration.split(' ')[0]);
  const startPrice = Number(answers.startPrice);
  const endPrice = Number(answers.endPrice);
  if (startPrice < endPrice) {
    die('Your start price cannot be less than your end price.');
  }

  let reductionTimeMS;
  switch (durationDays) {
    case 1:
      reductionTimeMS = 60 * 60 * 1000;
      break;
    case 3:
      reductionTimeMS = 3 * 60 * 60 * 1000;
      break;
    case 5:
    case 7:
    case 14:
      reductionTimeMS = 24 * 60 * 60 * 1000;
      break;
  }

  let outPath = answers.outPath;
  if (answers.outPath[0] === '~') {
    outPath = outPath.replace('~', process.env.HOME);
  }

  const auction = new Auction({
    name,
    startTime: Date.now(),
    endTime: Date.now() + durationDays * 24 * 60 * 60 * 1000,
    startPrice: startPrice * 1e6,
    endPrice: endPrice * 1e6,
    reductionTimeMS,
    reductionStrategy: linearReductionStrategy,
  });
  const proposals = await auction.generateProposals(context, nameObj.finalize);
  await writeProofFile(outPath, proposals, context);
}

async function listAuctions() {
  const db = await createDB(program.opts().prefix);
  const context = getContext();
  const names = await getNames(db);

  const table = new Table({
    head: [
      'Name',
      'Status',
      'Transfer Broadcast',
      'Transfer Confirmed',
      'Finalize Broadcast',
      'Finalize Confirmed',
      'Start Price',
      'End Price',
      'Current Price',
    ],
  });
  for (const name of names) {
    if (!name.transfer) {
      continue;
    }

    let status = 'UNKNOWN';
    let transferBroadcast = '-';
    let transferConfirmed = '-';
    let finalizeBroadcast = '-';
    let finalizeConfirmed = '-';
    let endPrice = '-';
    let startPrice = '-';
    let currPrice = '-';

    if (name.transfer) {
      const details = await name.transfer.getConfirmationDetails(context);
      transferBroadcast = formatDate(name.transfer.broadcastAt);
      if (details.confirmedAt) {
        transferConfirmed = formatDate(details.confirmedAt);
        status = 'TRANSFER_CONFIRMED_LOCKUP';

        if (details.spendable) {
          status = 'TRANSFER_CONFIRMED_FINALIZABLE';
        }
      } else {
        status = 'TRANSFER_MEMPOOL';
      }
    }

    if (name.finalize) {
      const details = await name.finalize.getConfirmationDetails(context);
      finalizeBroadcast = formatDate(name.finalize.broadcastAt);
      if (details.confirmedAt) {
        finalizeConfirmed = formatDate(details.confirmedAt);
        status = 'FINALIZE_CONFIRMED';
      } else {
        status = 'FINALIZE_MEMPOOL';
      }
    }

    if (name.auction) {
      status = 'AUCTION_LIVE';
      endPrice = (name.auction.endPrice / 1e6).toFixed(6);
      startPrice = (name.auction.startPrice / 1e6).toFixed(6);
      currPrice = (name.auction.priceFor(Date.now()) / 1e6).toFixed(6);
    }

    table.push([
      name.name,
      status,
      transferBroadcast,
      transferConfirmed,
      finalizeBroadcast,
      finalizeConfirmed,
      startPrice,
      endPrice,
      currPrice,
    ]);
  }

  console.log(table.toString());
}

async function fulfillAuction(proposalsPath) {
  const exists = fs.existsSync(proposalsPath);
  if (!exists) {
    die(`Proposals file not found.`);
  }

  const db = await createDB(program.opts().prefix);
  const context = getContext();
  const proofs = await readProofFile(proposalsPath);

  log('Verifying swap proofs.');
  for (let i = 0; i < proofs.length; i++) {
    const proof = proofs[i];
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(`>> Verified proof ${i + 1}.`);

    if (!await proof.verify(context)) {
      die(`Swap proof ${i + 1} is invalid - aborting.`);
    }
  }
  process.stdout.clearLine();
  process.stdout.cursorTo(0);

  log('Calculating best price.');

  let bestProof = null;
  for (const proof of proofs) {
    if (bestProof === null) {
      bestProof = proof;
    }

    if (Date.now() > proof.lockTime && proof.price < bestProof) {
      bestProof = proof;
    }
  }

  const table = new Table();
  table.push({
    'Name': bestProof.name,
  }, {
    'Price': `${(bestProof.price / 1e6).toFixed(6)} HNS`,
  }, {
    'Locking Script TX Hash': bestProof.lockingTxHash.toString('hex'),
  }, {
    'Locking Script Output Index': bestProof.lockingOutputIdx,
  }, {
    'Payment Address': bestProof.paymentAddr.toString(context.networkName),
  });
  console.log(table.toString());


  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Are you sure you want to fulfill the auction above? This action is not reversible. You are responsible for all blockchain fees.',
    },
  ]);

  if (!answers.confirmed) {
    die('Cancelled.');
  }

  const fulfillment = await fulfillSwap(context, bestProof);
  await putSwapFulfillment(db, fulfillment);
  log(`Fulfilled auction with transaction hash ${fulfillment.fulfillmentTxHash}.`);
  log(`Please wait 15 minutes for the blockchain to confirm the transaction.`);
}

async function finalizeAuction(name) {
  const db = await createDB(program.opts().prefix);
  const context = getContext();
  const nameObj = await getName(db, name);
  if (!nameObj.swapFulfillment) {
    die('This name is not fulfilled.');
  }

  const finalize = await finalizeSwap(context, nameObj.swapFulfillment);
  await putSwapFinalize(db, finalize);
}

async function listFulfillments() {
  const db = await createDB(program.opts().prefix);
  const context = getContext();
  const names = await getNames(db);

  const table = new Table({
    head: [
      'Name',
      'Status',
      'Price',
      'Fulfill Broadcast',
      'Fulfill Confirmed',
      'Finalize Broadcast',
      'Finalize Confirmed',
    ],
  });

  for (const name of names) {
    if (!name.swapFulfillment) {
      continue;
    }

    let status = 'FULFILL_TRANSFER_MEMPOOL';
    const fulfillBroadcastAt = formatDate(name.swapFulfillment.broadcastAt);
    let fulfillConfirmedAt = '-';
    let finalizeBroadcastAt = '-';
    let finalizeConfirmedAt = '-';

    const fulfillConfDetails = await name.swapFulfillment.getConfirmationDetails(context);
    if (fulfillConfDetails.confirmedAt) {
      fulfillConfirmedAt = formatDate(fulfillConfDetails.confirmedAt);
      status = 'FULFILL_TRANSFER_LOCKUP';

      if (fulfillConfDetails.spendable) {
        status = 'FULFILL_TRANSFER_FINALIZABLE';
      }
    }

    if (name.swapFinalize) {
      status = 'FULFILL_FINALIZE_MEMPOOL';
      finalizeBroadcastAt = formatDate(name.swapFinalize.broadcastAt);
      const confDetails = await name.swapFinalize.getConfirmationDetails(context);

      if (confDetails.confirmedAt) {
        status = 'FULFILL_FINALIZE_CONFIRMED';
        finalizeConfirmedAt = formatDate(confDetails.confirmedAt);
      }
    }

    table.push([
      name.name,
      status,
      (name.swapFulfillment.price / 1e6).toFixed(6),
      fulfillBroadcastAt,
      fulfillConfirmedAt,
      finalizeBroadcastAt,
      finalizeConfirmedAt,
    ]);
  }

  console.log(table.toString());
}

function die(msg) {
  console.log(msg);
  process.exit(1);
}

function log(msg) {
  console.log(`>> ${msg}`);
}