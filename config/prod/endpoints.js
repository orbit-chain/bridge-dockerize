module.exports = {
    // Node Endpoints
    endpoints : {
        avax: {
            rpc: ["https://avalanche-c-chain-rpc.publicnode.com", "https://ava-mainnet.public.blastapi.io/ext/bc/C/rpc", "http://prd-avax-mainnet.node.ozys.work:8545/ext/bc/C/rpc"],
            chain_id: '0xa86a',
            confirm: 10
        },
        bsc: {
            rpc : ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.binance.org", "http://prd-bsc-mainnet-rpc.node.ozys.work:8545"],
            confirm: 10
        },
        celo: {
            rpc: ["https://forno.celo.org", "https://rpc.ankr.com/celo", "http://prd-celo-mainnet-rpc.node.ozys.work:8545"],
            chain_id: '0xa4ec',
            confirm: 10
        },
        eth: {
            rpc: ["http://prd-eth-mainnet-erpc.node.ozys.work:8545", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
            beacon: "http://prd-eth-mainnet-brpc.node.ozys.work:8545",
            chain_id: '0x1',
            terminal_total_difficulty: "58750000000000000000000",
            confirm: 10
        },
        faireth: {
            rpc: "https://rpc.etherfair.org",
            socket: "wss://rpc.etherfair.org",
            chain_id: "0x7D44C",
            confirm: 10
        },
        fantom: {
            rpc: ["https://rpc.ftm.tools", "https://rpc.fantom.network", "https://rpc.ankr.com/fantom", "http://prd-fantom-mainnet-rpc.node.ozys.work:8545"],
            chain_id: '0xfa',
            confirm: 10
        },
        heco: {
            rpc : ["https://http-mainnet-node.huobichain.com", "http://prd-heco-mainnet-rpc.node.ozys.work:8545", "https://http-mainnet.hecochain.com"],
            chain_id: '0x80',
            confirm: 10
        },
        icon: {
            api: 'https://ctz.solidwallet.io/api/v3',
            rpc: 'https://ctz.solidwallet.io/api/v3',
            debug: 'https://ctz.solidwallet.io/api/debug/v3',
            version: 3,
            nid: 1,
            confirm: 10
        },
        klaytn: {
            is_kas: false,
            kas: {
                // KAS Default
                rpc: "https://node-api.klaytnapi.com/v1/klaytn",
                chain_id: 8217
            },
            rpc: ["https://public-en.node.kaia.io", "https://kaia.blockpi.network/v1/rpc/public", "https://klaytn.drpc.org"],
            confirm: 10
        },
        silicon: {
            rpc: ["https://rpc.silicon.network", "https://silicon-mainnet.nodeinfra.com"],
            chain_id: 2355,
            confirm: 10
        },
        matic: {
            rpc : ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com", "http://prd-matic-bor-mainnet-rpc.node.ozys.work:8545", "https://1rpc.io/matic"],
            chain_id: '0x89',
            confirm: 10
        },
        metadium: {
            rpc: ["https://api.metadium.com/prod"],
            socket: "ws://prd-meta-mainnet-ws.node.ozys.work:8545 ",
            confirm: 10
        },
        oec: {
            rpc: ["https://exchainrpc.okex.org", "http://prd-oktc-mainnet-rpc.node.ozys.work:8545"],
            chain_id: 66,
            confirm: 10
        },
        poweth: {
            rpc: "https://mainnet.ethereumpow.org",
            socket: "wss://mainnet.ethereumpow.org",
            chain_id: "0x2711",
            confirm: 10
        },
        stacks: {
            url: "https://stacks-node-api.mainnet.stacks.co",
            network: "mainnet",
            confirm: 10
        },
        ton: {
            rpc: "https://toncenter.com/api/v2/jsonRPC",
            confirm: 10
        },
        wemix: {
            rpc: "https://api.wemix.com",
            socket: "wss://ws.wemix.com",
            chain_id: 1111,
            confirm: 10
        },
        xdai: {
            rpc: ["https://rpc.gnosischain.com", "https://rpc.ankr.com/gnosis", "https://gnosis-mainnet.public.blastapi.io"],
            confirm: 10
        },
        xrp: {
            rpc: "https://s1.ripple.com:51234",
            socket: "wss://s1.ripple.com:443",
            confirm: 10
        },
    },
    VALIDATOR_MONITOR: {
        ozys: {
            monitor: "https://va.bridge.orbitchain.io/governance/report",
            orbit: "https://api.bridge.orbitchain.io",
            validator: "https://va.bridge.orbitchain.io",
            bible: "https://bridge.orbitchain.io/open",
            interval: 60 * 1000,
        },
    },
}
