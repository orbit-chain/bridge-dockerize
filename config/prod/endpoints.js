module.exports = {
    // Node Endpoints
    endpoints : {
        avax: {
            rpc: ["https://avalanche.drpc.org", "https://avalanche-c-chain-rpc.publicnode.com", "https://avax.api.pocket.network", "https://1rpc.io/avax/c"],
            chain_id: '0xa86a',
            confirm: 10
        },
        bsc: {
            rpc : ["https://bsc-rpc.publicnode.com", "https://bsc.meowrpc.com", "https://rpc.nodeflare.app/bnb/public", "https://bsc.api.pocket.network"],
            confirm: 10
        },
        celo: {
            rpc: ["https://forno.celo.org", "https://rpc.ankr.com/celo"],
            chain_id: '0xa4ec',
            confirm: 10
        },
        eth: {
            rpc: ["https://eth-mainnet.public.blastapi.io", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://gateway.tenderly.co/public/mainnet"],
            beacon: "https://eth-beacon-chain.drpc.org",
            chain_id: '0x1',
            terminal_total_difficulty: "58750000000000000000000",
            confirm: 10
        },
        klaytn: {
            is_kas: false,
            kas: {
                // KAS Default
                rpc: "https://node-api.klaytnapi.com/v1/klaytn",
                chain_id: 8217
            },
            rpc: ["https://public-en.node.kaia.io", "https://klaytn.drpc.org", "https://rpc.ankr.com/kaia"],
            confirm: 10
        },
        silicon: {
            rpc: ["https://rpc.silicon.network"],
            chain_id: 2355,
            confirm: 10
        },
        matic: {
            rpc : ["https://1rpc.io/matic", "https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"],
            chain_id: '0x89',
            confirm: 10
        },
        metadium: {
            rpc: ["https://api.metadium.com/prod"],
            socket: "ws://prd-meta-mainnet-ws.node.ozys.work:8545",
            confirm: 10
        },
        ton: {
            rpc: [
                {type:"toncenter",version:2},
                {type:"toncenter",version:3},
                {type:"quicknode",version:2},
                {type:"chainstack",version:2},
                {type:"chainstack",version:3},
                {type:"getblock",version:2},
                {type:"getblock",version:3},
            ],
            confirm: 10,
            min_healthy_cnt: 3,
        },
        wemix: {
            rpc: "https://api.wemix.com",
            socket: "wss://ws.wemix.com",
            chain_id: 1111,
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
            monitor: "https://va.orbitbridge.io/governance/report",
            orbit: "https://api.orbitbridge.io",
            validator: "https://va.orbitbridge.io",
            bible: "https://open.orbitbridge.io/open",
            interval: 60 * 1000,
        },
    },
}
