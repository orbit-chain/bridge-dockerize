module.exports = {
    // operating chain list
    chainList: [
        'eth-v1',
        'klaytn-v1',
        'icon-v1',
        'eth-v2',
        'klaytn-v2',
        'orbit',
    ],

    // Bridge Addresses
    BridgeAddress: {
        OrbitHubContract: "0x0000000000000000000000000000000000000000",
        EthBridgeContract: "0x0000000000000000000000000000000000000000",
        KlaytnBridgeContract: "0x0000000000000000000000000000000000000000",
        OrbitBridgeContract: "0x0000000000000000000000000000000000000000",
        MessageMultiSigWallet: {
            Hub: "0x0000000000000000000000000000000000000000",
            Eth: "0x0000000000000000000000000000000000000000",
            Klaytn: "0x0000000000000000000000000000000000000000",
            Icon: "0x0000000000000000000000000000000000000000",
            Orbit: "0x0000000000000000000000000000000000000000",
        },
        Eth: {
            EthVaultContract: "0x0000000000000000000000000000000000000000",
        },
        Klay: {
            KlaytnMinterContract: "0x0000000000000000000000000000000000000000",
            MessageMultiSigWallet: "0x0000000000000000000000000000000000000000",
        },
        Orbit: {
            OrbitMinterContract: "0x0000000000000000000000000000000000000000",
            MessageMultiSigWallet: "0x0000000000000000000000000000000000000000",
        },
        Governance: {
            Chain: "ETH",
            Address: "0x0000000000000000000000000000000000000000",
            Bytes: "0x0000000000000000000000000000000000000000",
            Id: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
    },

    // Node Endpoints
    Endpoints : {
        Orbit: {
            rpc : "http://orbitchain",
            socket: "ws://orbitchain",
        },
        Eth : {
            rpc : "http://infura",
            socket : "ws://infura",
        },
        Klaytn: {
            isKas: false,
            rpc: "https://api.cypress.klaytn.net:8651",
            socket: "wss://api.cypress.klaytn.net:8652",
            Kas: {
                // KAS Default
                rpc: "https://node-api.klaytnapi.com/v1/klaytn",
                chainId: 8217,

                // Your Credential
                accessKeyId: "",
                secretAccessKey: ""
            }
        },
    },

    DEBUG: true,
    LOGLEVEL: 'debug',

    // WIP: validator things.
    VALIDATOR_ACCOUNT: {
        TYPE: "PK",
        DATA: "0000000000000000000000000000000000000000000000000000000000000000",
    },
}
