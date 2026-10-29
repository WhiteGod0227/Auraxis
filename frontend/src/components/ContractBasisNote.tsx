export default function ContractBasisNote() {
  return (
    <aside className="basis-warning" aria-label="Contract comparison basis">
      <strong>Unit conversion does not remove location differences.</strong>
      <p>
        GOLDTEN and GOLDGUINEA use an Ahmedabad quoted-price basis; GOLDPETAL
        uses Mumbai. Converting to rupees per 10 g does not adjust for this
        location basis, delivery terms, or execution costs.
      </p>
      <details>
        <summary>Contract evidence reviewed 28 October 2026</summary>
        <p>
          <a
            href="https://www.mcxindia.com/docs/default-source/about-us/gold-ten-july-2026-contract-onwards.pdf"
            target="_blank"
            rel="noreferrer"
          >
            MCX GOLDTEN, July 2026 onward
          </a>
          : 10 g quote and lot; Ahmedabad basis. See pages 1–3.
        </p>
        <p>
          <a
            href="https://www.mcxindia.com/docs/default-source/about-us/gold-guinea-july-2026-contract-onwards.pdf"
            target="_blank"
            rel="noreferrer"
          >
            MCX GOLDGUINEA, July 2026 onward
          </a>
          : 8 g quote and lot; Ahmedabad basis. See page 1.
        </p>
        <p>
          <a
            href="https://www.mcxindia.com/docs/default-source/about-us/gold-petal-july-2026-contract-onwards.pdf"
            target="_blank"
            rel="noreferrer"
          >
            MCX GOLDPETAL, July 2026 onward
          </a>
          : 1 g quote and lot; Mumbai basis. See pages 1 and 3.
        </p>
        <p>
          The final-settlement conversion from 995 to 999 purity in the
          GOLDTEN/GOLDPETAL documents does not establish a universal multiplier
          for every historical futures quote. These sources support the listed
          units and locations, not profitability or complete economic
          equivalence.
        </p>
      </details>
    </aside>
  )
}
