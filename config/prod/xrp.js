module.exports = {
    // operating chain list
    chain_list: [
        'klaytn',
        'xrp',
        'avax',
        'bsc',
        'matic',
        "wemix",
        'silicon',
    ],
    silicon: {
        xrpBridge: "0x83bca9503D7888F2eFcDF18cCa2E79f8Ba75d17c",
        addressbook: "0x37CE54AFB91F3645b3e7455Cb4C5028507D6aBeB",
        multisig: "0xCe303B5740C70fFe4477E0d21E3B35770587F3B1",
    },
    // Bridge Addresses
    bridge_address: {
        klaytn: {
            minter: "0x917655B6C27A3D831b4193CE18ECe6bfcC806BF8",
            multisig: "0x22Bef83bABcC1169855D748D13523CA10aD87dF7",
        },
        bsc: {
            minter: "0xE38ca00A6FD34B793012Bb9c1471Adc4E98386cF",
            multisig: "0xfa50391705D2FA7ac47Dd211B78378825bc763e6",
            admin: "0x009071058740276327A393B084eC447b8F0Fc6Ae",
        },
        matic: {
            minter: "0xE38ca00A6FD34B793012Bb9c1471Adc4E98386cF",
            multisig: "0xfa50391705D2FA7ac47Dd211B78378825bc763e6",
            admin: "0x009071058740276327A393B084eC447b8F0Fc6Ae",
        },
        wemix: {
            minter: "0x3fc270534bBEEF400777B587D03fc66D8Ddd716E",
            multisig: "0x60D85ED151CBdE337019263A54AD2fb6b495547C",
            admin: "0xC9bD6dE100b923C275e74dC75F895B50c7488eD3",
        },
        silicon: {
            minter: "0x065BaE5639EB5718E0F76B27967f582e4b7d63a8",
            multisig: "0xCe303B5740C70fFe4477E0d21E3B35770587F3B1",
            admin: "0x478172a50906CaC395F8567a8dC001c7EeCB2A0A",
        },
        governance: {
            chain: "XRP",
            address: "rJTEBWu7u1NcJAiMQ9iEa1dbsuPyhTiW23",
            bytes: "0x00bf70ca91c426e78c28f0fa724e679d50ac59f9378a71efbd",
            id: "0x4f1d4170def98e5be4eb9a487615c2e39939c184839448e44096bafc42f5ee65",
        },
    }
}