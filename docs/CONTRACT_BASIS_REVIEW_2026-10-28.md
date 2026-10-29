# Contract-basis review — 28 October 2026

The following official MCX futures specifications were read directly. This checks the listed terms, not data redistribution rights or executable equivalence.

| Product | Lot grams | Quote grams | Quoted-price location | Source |
| --- | --- | --- | --- | --- |
| GOLDM | 100 | 10 | Ahmedabad | [August 2026 onward specification, page 1](https://www.mcxindia.com/docs/default-source/about-us/gold-mini-august-2026-contract-onwards8a79913a-e8de-4136-9f0b-25d31dc163c4.pdf) |
| GOLDTEN | 10 | 10 | Ahmedabad | [July 2026 onward specification, page 1](https://www.mcxindia.com/docs/default-source/about-us/gold-ten-july-2026-contract-onwards.pdf) |
| GOLDGUINEA | 8 | 8 | Ahmedabad | [July 2026 onward specification, page 1](https://www.mcxindia.com/docs/default-source/about-us/gold-guinea-july-2026-contract-onwards.pdf) |
| GOLDPETAL | 1 | 1 | Mumbai | [July 2026 onward specification, page 1](https://www.mcxindia.com/docs/default-source/about-us/gold-petal-july-2026-contract-onwards.pdf) |

The configured lot/quote quantities agree with these specifications. The Gold Ten and Gold Petal final-settlement sections (page 3) use different city spot references and describe a 995-to-999 conversion; Gold Petal additionally scales the reference to 1 g. This is evidence about those settlement procedures, not a universal adjustment for all historical futures prices.

Consequence: same-expiry GOLDTEN/GOLDPETAL comparisons retain a location basis even after normalization to rupees per 10 g. The new walkthrough/methodology note makes this visible. No location adjustment was invented, no purity defaults changed, and no simulated P&L was presented as verified arbitrage.

Still unresolved: full quote-price equivalence, applicable delivery/fee/tax/margin treatment in every simulation, execution liquidity, and market-data redistribution permission. A complete economic certification is not claimed.
