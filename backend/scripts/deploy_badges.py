"""Deploy AuraxisBadges to the configured TEST network and verify it.

Usage (from backend/, with WEB3_SIGNER_KEY in .env and the server address
funded with test ETH):

    .venv/Scripts/python.exe scripts/deploy_badges.py

Prints the contract address to set as WEB3_CONTRACT. Refuses to deploy to a
chain whose id differs from WEB3_CHAIN_ID or without funds for gas.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.data import evm  # noqa: E402

MIN_BALANCE_WEI = 10**14  # 0.0001 test ETH


def call(chain: evm.Chain, to: str, signature: str, *args) -> str:
    return chain.call(to, evm.call_data(signature, *args))


def verify(chain: evm.Chain, address: str) -> None:
    """Read the deployed contract back and check what matters."""
    code = chain.rpc("eth_getCode", [address, "latest"])
    assert code and len(code) > 2, "No code at the contract address"
    operator = "0x" + call(chain, address, "operator()")[-40:]
    assert operator.lower() == chain.address.lower(), "operator mismatch"
    for interface in ("0x80ac58cd", "0x5b5e139f", "0xb45a3c0e", "0x01ffc9a7"):
        word = call(chain, address, "supportsInterface(bytes4)", interface)
        assert evm.decode_uint(word) == 1, f"interface {interface} not supported"
    try:
        call(
            chain,
            address,
            "transferFrom(address,address,uint256)",
            chain.address,
            chain.address,
            1,
        )
        raise AssertionError("transferFrom should revert (soulbound)")
    except evm.EvmError:
        pass
    print("Verified: code present, operator, ERC-165/721/721-metadata/5192, soulbound.")


def main() -> None:
    settings = get_settings()
    if len(sys.argv) == 3 and sys.argv[1] == "--verify":
        chain = evm.Chain(
            settings.web3_rpc_url, settings.web3_chain_id, settings.web3_signer_key
        )
        address = evm.ethsig.checksum_address(sys.argv[2])
        verify(chain, address)
        print(f"WEB3_CONTRACT={address}")
        return
    if not settings.web3_signer_key:
        raise SystemExit("WEB3_SIGNER_KEY is not set in backend/.env")
    chain = evm.Chain(
        settings.web3_rpc_url, settings.web3_chain_id, settings.web3_signer_key
    )
    remote_id = evm.decode_uint(chain.rpc("eth_chainId", []))
    if remote_id != settings.web3_chain_id:
        raise SystemExit(
            f"Node is on chain {remote_id}, expected {settings.web3_chain_id}"
        )
    balance = chain.balance()
    print(f"Network: {settings.web3_network_name} ({remote_id})")
    print(f"Server address: {chain.address}  balance: {balance / 1e18:.6f} ETH")
    if balance < MIN_BALANCE_WEI:
        raise SystemExit("Not enough test ETH for gas. Fund the server address first.")

    artifact = evm.artifact()
    bytecode = bytes.fromhex(artifact["bytecode"][2:])
    data = bytecode + evm.encode_word("address", chain.address)
    nonce = evm.decode_uint(
        chain.rpc("eth_getTransactionCount", [chain.address, "pending"])
    )
    expected = evm.contract_address(chain.address, nonce)
    tx_hash = chain.send(None, data)
    print(f"Deploy transaction: {settings.web3_explorer.rstrip('/')}/tx/{tx_hash}")
    receipt = chain.wait(tx_hash, timeout=180)
    if receipt.get("status") != "0x1":
        raise SystemExit("Deployment reverted.")
    address = evm.ethsig.checksum_address(receipt["contractAddress"])
    assert address == expected, f"{address} != predicted {expected}"
    code = chain.rpc("eth_getCode", [address, "latest"])
    assert code and len(code) > 2, "No code at the contract address"

    verify(chain, address)
    print(f"Contract: {settings.web3_explorer.rstrip('/')}/address/{address}")
    print(f"WEB3_CONTRACT={address}")


if __name__ == "__main__":
    main()
