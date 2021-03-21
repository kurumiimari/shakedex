CLI Guide
=========

This guide will walk you through how to buy and sell Handshake names using the ShakeDex CLI.

Prerequisites
-------------

ShakeDex requires Node.js and NPM to be installed, so download those if you haven't already. You will also need to run
an HSD node with transaction indexing turned on. To do this, run HSD as follows:

.. code-block::

    hsd --index-tx

Installation
------------

Install shakedex as a global utility using the following command:

.. code-block::

    npm i -g shakedex

To test your installation, run:

.. code-block::

    shakedex --version

If everything was installed correctly, your terminal should output the current ShakeDex version.


Global Options
--------------

Depending on how your HSD node is set up, you may need to pass additional options to shakedex. These options are:

* :code:`-n` Sets the Handshake network to connect to. Should match HSD's network option.
* :code:`-w` Sets the wallet ID to conenct to. By default this is set to :code:`primary`, but if you have multiple
  wallets you'll need to set this to the appropriate one. Note that Bob Wallet uses :code:`allison` as its default
  wallet ID.
* :code:`--no-password` Disables passphrase prompts. Use this if you have not set a passphrase for your HSD wallet.
  The passphrase prompt does not permit empty passwords.

Viewing Auctions
----------------

You can view the status of your auctions by running :code:`shakedex list-auctions`. Note that your auctions list will
include names that are in the process of being transferred to the locking script.

Creating an Auction
-------------------

First, you need to transfer your name to the locking script. Use the following two commands to do this:

.. code-block::

    shakedex transfer-lock <name>

    # Wait 48 hours

    shakedex finalize-lock <name>

Then, run :code:`shakedex create-auction <name>` to launch an interactive process that will create your presigns. As
part of this process, you can optionally upload your presigns to `ShakeDex Web`_. Otherwise, they will be outputted
on-disk as a text file.

Viewing Fills
-------------

You can view the status of your fills by running :code:`shakedex list-fills`.

Filling an Auction
------------------

To fill an auction, you'll need the presigns file generated during the :code:`create-auction` process. Once you have the
presigns file, run :code:`shakedex fill-auction <path-to-presigns>` to fill the auction. The CLI will confirm the
pricing with you before broadcasting.

Cancelling an Auction
---------------------

Cancelling an auction is very similar to creating an auction. Once your name has been finalized to the locking script,
run the following:

.. code-block::

    shakedex transfer-lock-cancel <name>

    # Wait 48 hours

    shakedex finalize-lock-cancel <name>

Your name will appear in your HSD wallet after the :code:`FINALIZE` transaction confirms.

.. _ShakeDex Web: https://www.shakedex.com