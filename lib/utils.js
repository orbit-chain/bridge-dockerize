function getEndpoint (chain) {
    return require(ROOT + `/config/endpoints`).endpoints[chain.toLowerCase()]
}

function contractAddress (layer2Chain) {
    let { bridge_address } = require(ROOT + `/config/${process.env.CHAIN.toLowerCase()}`)
    return bridge_address[layer2Chain]
}

function multisigAddress(migChain) {
    let { bridge_address } = require(ROOT + `/config/${process.env.CHAIN.toLowerCase()}`)
    return bridge_address[migChain].multisig
}

function ed25519MultisigAddress() {
    let { bridge_address } = require(ROOT + `/config/${process.env.CHAIN.toLowerCase()}`)
    return bridge_address.multisig.ton;
}

function isEvmAddress(address) {
    return address.slice(0,2) === "0x" && address.length === 42;
}

module.exports = {
    getEndpoint,
    contractAddress,
    multisigAddress,
    ed25519MultisigAddress,
    isEvmAddress
}