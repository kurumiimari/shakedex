Proposal: Community Burn
========================

**Authors:** Kurumi Imari and sai7o

Overview
--------

This proposal describes a fee model for ShakeDex in which users must burn HNS in order to list their names on ShakeDex
Web. We consider this model an experiment with capped downside yet potentially massive rewards.

The technical implementation of the burn will not be described here. Instead, we will focus on the justification behind
the burn in an effort to spur discussion and build community consensus around it.

Note that this proposal, even if implemented, does not force users to pay fees to any single party. The underlying
ShakeDex exchange protocol would still be the same, and any unwanted changes can be forked out.

On Burning
----------

Normally, actors pay providers for products and services. With a community burn, actors pay the commons for a product or
service - in effect, making all HNS coin holders the recipients of the usage fee. This makes the burn
`credibly neutral`_. These two properties combine to create a fee model that other projects - not just ShakeDex - can
adopt for the betterment of the Handshake community as a whole without privileging a specific project's treasury. This
is a powerful idea that that "locks the door open" for other groups to contribute to ShakeDex (and Handshake as a whole)
in ways that grow the pie. The more venues support the burn model, the more locked-in and fork resistant the model
becomes, and the more likely new projects will be to adopt it themselves. If we follow this through to its conclusion,
then a successful community burn on ShakeDex sets a community-wide default that enriches all HNS holders.

Additionally, this may also be the best way to incentivize centralized exchanges to adopt protocols like ShakeDex
natively. This would be in contrast to creating their own non-custodial, trusted venue a la Binance. Any new exchange,
from Kraken to Namecheap, can build on top of Shakedex's mechanisms, without worrying about the growth accruing to a
decentralized "competitor."

In sum: by burning, ShakeDex can position itself as a protocol and incentivization layer underneath every venue just by
existing and building in the open, without any coercion.

On Funding
----------

Our current exchange volume is not enough to generate meaningful fee revenue to fund the projects. This is fine,
however, as Kurumi has enough personal funds to continue ShakeDex development for the next several months.

Over the long term, we will likely issue a ShakeDex token of some kind. We believe a token will be useful for several
reasons:

1. We want our community members to share in the protocol's success.
2. In the medium-term, we believe that the token will produce superior returns to raw fee revenue.
3. We want to decentralize ShakeDex's governance.

The burn is integral to this strategy. The burn lets us airdrop to whoever performed a burn, and imbue the new token
with the value of the burned coins. It also lets us defer the creation of ShakeDex's governance mechanism until we are
ready, as the ShakeDex team will not be able to spend burned funds without first specifying how the governance model
will work and performing the airdrop.

Note that the specific token model is not settled yet. We are considering everything from usage rewards to a dev
treasury. Without making any promises, if you are a member of the early community you will be a part of anything we come
up with together.

Parting Thoughts
----------------

Is important to consider how reversible the burn experiment is. Anyone - including the ShakeDex dev team - can fork and
deploy a new venue that pays fees to the operator. This requires no community coordination. Switching from a
fee-to-operator model to a burn, however, is much harder. Once multiple venues are established, each with their own
teams, investors, communities, and the like, how can the community convince each venue to lower their revenue share for
the benefit of the community? It is much harder, if not impossible. If we are to try a burn experiment, we should try it
first and try it now.

There is a curious symmetry here, in Handshake itself. Its most novel and promising mechanisms are so because they are
so hard to reverse, and took a lot of coordination to set the initial network state. They will take years to play out.
We see this in the base Handshake auction mechanism. We saw this recently in community debates around HNS money supply.
As a naming system, Handshake itself aligns with lowering returns to forking and Shakedex's potential burn fits together
cleanly.

As with all worthwhile experiments, this is high risk high reward: the mean outcome is that the burns end up being
irrelevant and taken away. If it does work, however, it may massively affect Handshake price appreciation. The Shakedex
community burn could burn over 10x the Vickrey auction burns over the lifetime of the chain. This is why we must try it.

.. _credibly neutral: https://nakamoto.com/credible-neutrality/