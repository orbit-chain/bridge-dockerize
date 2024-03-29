module.exports = {
    // Node Endpoints
    endpoints : {
        orbit: {
            rpc : "https://bridge-en.orbitchain.io:7443",
            socket: "wss://bridge-en.orbitchain.io:7444",
        },
        avax: {
            rpc: ["https://api.avax.network/ext/bc/C/rpc", "https://rpc.ankr.com/avalanche", "https://ava-mainnet.public.blastapi.io/ext/bc/C/rpc", "http://prd-avax-mainnet.node.ozys.work:8545/ext/bc/C/rpc"],
            chain_id: '0xa86a'
        },
        bsc: {
            rpc : ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.binance.org", "https://rpc.ankr.com/bsc", "http://prd-bsc-mainnet-rpc.node.ozys.work:8545"],
        },
        celo: {
            rpc: ["https://forno.celo.org", "https://rpc.ankr.com/celo", "http://prd-celo-mainnet-rpc.node.ozys.work:8545"],
            chain_id: '0xa4ec'
        },
        eth: {
            rpc: ["http://prd-eth-mainnet-erpc.node.ozys.work:8545", "https://rpc.ankr.com/eth"],
            beacon: "http://prd-eth-mainnet-brpc.node.ozys.work:8545",
            chain_id: '0x1'
        },
        faireth: {
            rpc: "https://rpc.etherfair.org",
            socket: "wss://rpc.etherfair.org",
            chain_id: "0x7D44C",
        },
        fantom: {
            rpc: ["https://rpc.ftm.tools", "https://rpc.fantom.network", "https://rpc.ankr.com/fantom", "http://prd-fantom-mainnet-rpc.node.ozys.work:8545"],
            chain_id: '0xfa'
        },
        harmony: {
            rpc: ["https://api.harmony.one", "https://rpc.ankr.com/harmony", "https://harmony-mainnet.chainstacklabs.com"],
            chain_id: 1666600000
        },
        heco: {
            rpc : ["https://http-mainnet-node.huobichain.com", "http://prd-heco-mainnet-rpc.node.ozys.work:8545", "https://http-mainnet.hecochain.com"],
            chain_id: '0x80'
        },
        icon: {
            api: 'https://ctz.solidwallet.io/api/v3',
            rpc: 'https://ctz.solidwallet.io/api/v3',
            debug: 'https://ctz.solidwallet.io/api/debug/v3',
            version: 3,
            nid: 1
        },
        klaytn: {
            is_kas: false,
            kas: {
                // KAS Default
                rpc: "https://node-api.klaytnapi.com/v1/klaytn",
                chain_id: 8217
            },
            rpc: ["https://klaytn-mainnet-rpc.allthatnode.com:8551", "https://public-en-cypress.klaytn.net", "https://klaytn.blockpi.network/v1/rpc/public"],
        },
        matic: {
            rpc : ["https://polygon-rpc.com", "http://prd-matic-bor-mainnet-rpc.node.ozys.work:8545", "https://rpc.ankr.com/polygon"],
            chain_id: '0x89'
        },
        metadium: {
            rpc: ["https://api.metadium.com/prod"],
            socket: "ws://prd-meta-mainnet-ws.node.ozys.work:8545 ",
        },
        moonriver: {
            rpc: ["https://moonriver.public.blastapi.io", "https://rpc.api.moonriver.moonbeam.network"],
        },
        oec: {
            rpc: ["https://exchainrpc.okex.org", "http://prd-oktc-mainnet-rpc.node.ozys.work:8545"],
            chain_id: 66
        },
        poweth: {
            rpc: "https://mainnet.ethereumpow.org",
            socket: "wss://mainnet.ethereumpow.org",
            chain_id: "0x2711"
        },
        stacks: {
            url: "https://stacks-node-api.mainnet.stacks.co",
            network: "mainnet",
        },
        ton: {
            rpc: "https://toncenter.com/api/v2/jsonRPC",
        },
        wemix: {
            rpc: "https://api.wemix.com",
            socket: "wss://ws.wemix.com",
            chain_id: 1111
        },
        xdai: {
            rpc: ["https://rpc.gnosischain.com", "https://rpc.ankr.com/gnosis", "https://gnosis-mainnet.public.blastapi.io"],
        },
        xrp: {
            rpc: "https://s1.ripple.com:51234",
            socket: "wss://s1.ripple.com:443",
        },
    },

    LOGLEVEL: 'debug',

    VALIDATOR_MONITOR: {
        ozys: {
            endpoint: "https://va.bridge.orbitchain.io.prod.ozys.work/v1/validator/report",
            interval: 60 * 1000,
        },
    },
}
