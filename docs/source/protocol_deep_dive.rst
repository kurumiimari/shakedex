Protocol Deep Dive
==================

This document outlines ShakeDex's underlying auction protocol. Its intended audience is developers who wish to either
integrate with the on-chain transactions ShakeDex generates or learn more about how ShakeDex works under-the-hood.
Reading this is not required to use ShakeDex.

Nomenclature
------------

The following nomenclature will be used to describe the parties involved in a ShakeDex auction:

* **Alice:** The seller of a name.
* **Bob:** The buyer of a name.

Protocol
--------

ShakeDex is based on `HIP-0001: Non-Interactive Name Swaps`_. HIP-0001 breaks name exchange into three phases:

1. Setup
2. Trading
3. Filling

We'll walk you through each phase below. We'll also walk through how cancelling an auction works.

Setup
^^^^^

Transferring ownership of a Handshake name requires two transactions: a `TRANSFER`, which initiates the
change-in-ownership, and a `FINALIZE`, which makes the transfer permanent. The transferor must wait approximately 48
hours after broadcasting the `TRANSFER` transaction before broadcasting the `FINALIZE` transaction. This gives them time
to change their mind by broadcasting a `CANCEL`, or (in case of emergency) revoke their ownership of the name altogether
by broadcasting a `REVOKE`.

To make name auctions atomic, ShakeDex needs to prevent names on the protocol from being cancelled or revoked. It does
this via the following locking script:

.. code-block::

    OP_TYPE
    0x09 // TRANSFER
    OP_EQUAL
    OP_IF
      <name-owner's public key>
      OP_CHECKSIG
    OP_ELSE
      OP_TYPE
      0x0a // FINALIZE
      OP_EQUAL
    OP_ENDIF

The script uses `OP_TYPE` to prevent spending a name to any output whose covenant is not `TRANSFER` or `FINALIZE`.

The ShakeDex "Setup" phase refers the process of transferring ownership to this locking script. It works like this:

* Alice transfers the name to the locking script.
* Alice waits 48 hours for the transfer lockup to expire.
* Alice finalizes the name to the locking script.

Diagrammed, these transactions look like this:

.. code-block::

     ┌────────────────────────────────────────────────────────────────────┐
     │ superdope                                                          │
     │                                                                    │
     │ ┌────────────────────────────────────────────────────────────────┐ │
     │ │                            TRANSFER                            │ │
     │ │                                                                │ │
     │ │ ┌───────────────────────────┐    ┌───────────────────────────┐ │ │
     │ │ │    NAMEHASH(SUPERDOPE)    │  ┌─▶ OP_TYPE                   │ │ │
     │ │ ├───────────────────────────┤  │ │ <int transfer>            │ │ │
     │ │ │     HASH(LOCK_SCRIPT)     │──┘ │ OP_EQUAL                  │ │ │
     │ │ └───────────────────────────┘    │ OP_IF                     │ │ │
     │ │                                  │   <pubkey>                │ │ │
     │ │                                  │   OP_CHECKSIG             │ │ │
     │ │                                  │ OP_ELSE                   │ │ │
     │ │                                  │   OP_TYPE                 │ │ │
     │ │                                  │   <int finalize>          │ │ │
     │ │                                  │   OP_EQUAL                │ │ │
     │ │                                  │ OP_ENDIF                  │ │ │
     │ │                                  └───────────────────────────┘ │ │
     │ └────────────────────────────────────────────────────────────────┘ │
     │ ┌────────────────────────────────────────────────────────────────┐ │
    ┌┼─│                       SIGHASH_ALL(ALICE)                       │ │
    ││ └────────────────────────────────────────────────────────────────┘ │
    │└────────────────────────────────────────────────────────────────────┘
    │
    │┌───────────────────────────────┐
    ││ superdope                     │
    ││                               │
    │├──────────────VIN──────────────┤
    ││                               │
    ││ ┌───────────────────────────┐ │
    └┼▶│         TRANSFER          │ │
     │ └───────────────────────────┘ │
     │                               │
     ├──────────────VOUT─────────────┤
     │                               │
     │ ┌───────────────────────────┐ │
     │ │         FINALIZE          │ │
     │ └───────────────────────────┘ │
     │ ┌───────────────────────────┐ │
     │ │    SIGHASH_ALL(ALICE)     │ │
     │ └───────────────────────────┘ │
     └───────────────────────────────┘

Once the name has been `FINALIZED` to the locking script, Alice can move on to the Trading phase.

Trading
^^^^^^^

Once the name is owned by the locking script, Alice can craft a set of pre-signed transactions that will together form
an auction. The pre-signs consist of the following components:

1. An input representing the `FINALIZE` transaction she created earlier.
2. An output transferring the name to a dummy address.
3. An output paying Alice some amount for the name.
4. A lock time that prevents the pre-sign from being spent before a particular block time.
5. A signature from Alice using `SIGHASH_SINGLE_REVERSE`.

Diagrammed, the presign looks like this:

.. code-block::

    ┌───────────────────────────────┐    ┌───────────────────────────────┐
    │ superdope                     │    │superdope                      │
    │                               │    │                               │
    ├──────────────VIN──────────────┤    ├──────────────VIN──────────────┤
    │                               │    │                               │
    │ ┌───────────────────────────┐ │    │ ┌───────────────────────────┐ │
    │ │         TRANSFER          │ │ ┌──┼▶│         FINALIZE          │ │
    │ └───────────────────────────┘ │ │  │ └───────────────────────────┘ │
    │                               │ │  │                               │
    ├──────────────VOUT─────────────┤ │  ├─────────────VOUT──────────────┤
    │                               │ │  │                               │
    │ ┌───────────────────────────┐ │ │  │ ┌───────────────────────────┐ │
    │ │         FINALIZE          │ │ │  │ │         TRANSFER          │ │
    │ └───────────────────────────┘ │ │  │ │                           │ │
    │ ┌───────────────────────────┐ │ │  │ │ ┌───────────────────────┐ │ │
    │ │    SIGHASH_ALL(ALICE)     │─┼─┘  │ │ │  NAMEHASH(SUPERDOPE)  │ │ │
    │ └───────────────────────────┘ │    │ │ ├───────────────────────┤ │ │
    └───────────────────────────────┘    │ │ │         DUMMY         │ │ │
                                         │ │ └───────────────────────┘ │ │
                                         │ └───────────────────────────┘ │
                                         │ ┌───────────────────────────┐ │
                                         │ │          PAYMENT          │ │
                                         │ │                           │ │
                                         │ │ ┌───────────────────────┐ │ │
                                         │ │ │    ALICE_RECV_ADDR    │ │ │
                                         │ │ ├───────────────────────┤ │ │
                                         │ │ │      10,000 HNS       │ │ │
                                         │ │ └───────────────────────┘ │ │
                                         │ └───────────────────────────┘ │
                                         │ ┌───────────────────────────┐ │
                                         │ │         nLockTime         │ │
                                         │ ├───────────────────────────┤ │
                                         │ │ SIGHASH_SINGLE_REV(ALICE) │ │
                                         │ └───────────────────────────┘ │
                                         └───────────────────────────────┘

This construction works because `SIGHASH_SINGLE_REVERSE` only signs over the first input and the last output of a given
transaction. Anyone can replace the dummy address in the transfer output with their own, and the transaction will be
valid as long as Alice's payment output is funded.

If we create a bag of presigns such that their lock time increases as the payment to Alice decreases, we can approximate
an on-chain Dutch auction. Dutch auctions are auctions in which the seller begins with a high asking price, and lowers
it until someone accepts the price. In this case, Bob would accept the price by "filling" the auction, which we'll cover
in the next section.

Filling
^^^^^^^

Filling a Shakedex auction is the act of funding a presign by adding additional inputs to cover the seller's
self-payment, and setting the `TRANSFER` output's address to the buyer's. Diagrammed, a fill transaction looks like
this:

.. code-block::

                                  ┌───────────────────────────────┐
                                  │superdope                      │
                                  │                               │
                                  ├──────────────VIN──────────────┤
    ┌───────────────────────┐     │                               │
    │Coin                   │     │ ┌───────────────────────────┐ │
    │                       │     │ │         FINALIZE          │ │
    │ ┌───────────────────┐ │     │ └───────────────────────────┘ │
    │ │    10,0002 HNS    │ │     │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
    │ └───────────────────┘ ├─────┼▶           FUNDING            │
    └───────────────────────┘     │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
                                  │                               │
                                  ├─────────────VOUT──────────────┤
                                  │                               │
                                  │ ┌───────────────────────────┐ │
                                  │ │         TRANSFER          │ │
                                  │ │                           │ │
                                  │ │ ┌───────────────────────┐ │ │
                                  │ │ │  NAMEHASH(SUPERDOPE)  │ │ │
                                  │ │ ├───────────────────────┤ │ │
                                  │ │       BOB_RECV_ADDR       │ │
                                  │ │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │ │
                                  │ └───────────────────────────┘ │
                                  │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
                                  │            CHANGE             │
                                  │ │                           │ │
                                  │   ┌───────────────────────┐   │
                                  │ │ │    BOB_CHANGE_ADDR    │ │ │
                                  │   ├───────────────────────┤   │
                                  │ │ │         1 HNS         │ │ │
                                  │   └───────────────────────┘   │
                                  │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
                                  │ ┌───────────────────────────┐ │
                                  │ │          PAYMENT          │ │
                                  │ │                           │ │
                                  │ │ ┌───────────────────────┐ │ │
                                  │ │ │    ALICE_RECV_ADDR    │ │ │
                                  │ │ ├───────────────────────┤ │ │
                                  │ │ │      10,000 HNS       │ │ │
                                  │ │ └───────────────────────┘ │ │
                                  │ └───────────────────────────┘ │
                                  │ ┌───────────────────────────┐ │
                                  │ │         nLockTime         │ │
                                  │ ├───────────────────────────┤ │
                                  │ │ SIGHASH_SINGLE_REV(ALICE) │ │
                                  │ ├───────────────────────────┤ │
                                  │       SIGHASH_ALL(BOB)        │
                                  │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
                                  └───────────────────────────────┘


Note the input and output with dashed borders: Bob is adding these to the presign, then signing over all of them with
an additional `SIGHASH_ALL`. Specifically, he is adding a coin with a value of 10,002 HNS to the transaction. 10,000 HNS
will go to fund the payment to Alice, and 1HNS will go to network fees. The remaining 1 HNS will go back to Bob in the
form of a change output. The order of inputs and outputs matters here. The `FINALIZE` input must come first, and Alice's
payment output must come last. This preserves the validity of Alice's `SIGHASH_SINGLE_REVERSE`.

Once Bob broadcasts his fill, the name is irrevocably his even though he must still finalize the transfer. The locking
script prevents Alice from cancelling or revoking the transfer; as a result only valid destination for the name is a
`FINALIZE`.

Cancellation
^^^^^^^^^^^^

It is possible for Alice to cancel an auction once she has finalized her name to the locking script. A cancellation
simply transfers the name from the locking script back to an address that Alice controls. Auctions are still atomic:
an auction presign cannot be filled if the name is already in a TRANSFER state.

Once the transfer lockup expires, Alice finalizes the name to herself and can re-auction the name if she so chooses.

.. _HIP-0001\: Non-Interactive Name Swaps: https://github.com/handshake-org/HIPs/blob/master/HIP-0001.md