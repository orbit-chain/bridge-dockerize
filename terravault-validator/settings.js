module.exports = {
    // operating chain list
    chainList: [
        'eth',
        'klaytn',
        "terra",
    ],

    // Bridge Addresses
    BridgeAddress: {
        OrbitHubContract: "0x0000000000000000000000000000000000000000",
        OrbitBridgeHubContract: "0x0000000000000000000000000000000000000000",
        EthBridgeContract: "0x0000000000000000000000000000000000000000",
        KlaytnBridgeContract: "0x0000000000000000000000000000000000000000",
        TerraBridgeContract: "0x0000000000000000000000000000000000000000",
        MessageMultiSigWallet: {
            Hub: "0x0000000000000000000000000000000000000000",
            Eth: "0x0000000000000000000000000000000000000000",
            Klaytn: "0x0000000000000000000000000000000000000000",
            Terra: "0x0000000000000000000000000000000000000000",
        },
        Eth: {
            EthVaultContract: "0x0000000000000000000000000000000000000000",
        },
        Klay: {
            KlaytnMinterContract: "0x0000000000000000000000000000000000000000",
            MessageMultiSigWallet: "0x0000000000000000000000000000000000000000",
        },
        Governance: {
            Chain: "TERRA",
            Address: "terra1",
            Bytes: "",
            Id: "0x0000000000000000000000000000000000000000000000000000000000000000",
            Threshold: 2,
            Pubkeys: [
                "terrapub1",
                "terrapub1",
                "terrapub1",
                "terrapub1",
                "terrapub1",
                "terrapub1",        
            ],
        },
        TerraGovernances: {
            Orbit: "terra1",
        },
        Denoms: {
            "ukrw": "krt",
            "uluna": "luna",
            "umnt": "mnt",
            "usdr": "sdr",
            "uusd": "ust"
        }
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
            rpc: "https://api.cypress.klaytn.net:8651",
            socket: "wss://api.cypress.klaytn.net:8652",
        },
        Terra: {
            networkId: "columbus-4",
            lcd: "https://lcd.terra.dev",
            gasPrices: {
                uluna: 0.00506,
                uusd: 0.0015,
                usdr: 0.00102,
                ukrw: 1.7805,
                umnt: 4.31626,
            },        
            fcd: "https://fcd.terra.dev",
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