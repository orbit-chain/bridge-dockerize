module.exports = {
    chain_list: [
        "avax",
        "bsc",
        "celo",
        "heco",
        "fantom",
        "klaytn",
        "matic",
        "moonriver",
        "orbit",
        "oec",
        "xdai",
        "eth",
        "ton_layer_1",
    ],

    // Bridge Addresses
    bridge_address: {
        orbit_hub: "0xb5680a55d627c52de992e3ea52a86f19da475399",
        bsc_bridge: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
        heco_bridge: "0xE7688F64e96A733EaDdCb5850392347e67Bb197f",
        klaytn_bridge: "0x1af95905bb0042803f90e36d79d13aea6cd58969",
        orbit_bridge: "0x77a49649964a186Fd2b8754758c39c9438a6E9aB",
        ton_bridge: "0xB773f5A2C0537964efC07B2ED13C89cE8FE7CCbA",
        ton_address_book: "0x005be6cAF238609E23949EF75fC1a0a13Ea02928",
        multisig: {
            hub: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            ton: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            orbit: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            avax: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            bsc: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            celo: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            fantom: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            heco: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            klaytn: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            matic: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            moonriver: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            oec: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            xdai: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
        },
        ton: {
            vault: "EQB8mNTgoG5QxqhOdVFi6X0MOjkmGNd33ct-RGBT9ZT5oDAX",
            multisig: "EQAcY1y-LVL9pj_X1F6vhbGE7m6x50jRMxZJZg44md76hngN",
        },
        avax: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        bsc: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        celo: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        eth: {
            minter: "0x5Cc6a1Dc39E523eFd6C42534a478942Cadd24f8C",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        fantom: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        heco: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        klaytn: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
        },
        matic: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        moonriver: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        oec: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        xdai: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
            admin: "0x8966c07b38dcb277f1e5264368Cafb289DBCab4f",
        },
        orbit: {
            minter: "0x58A42330c0984babD5DEc2C943eAA345B7f41e44",
            multisig: "0x4dd5c30ae4a140d3B9180c778bD2e74c8e64E38A",
        },
        governance: {
            chain: "TON_LAYER_1",
            address: "EQCKFA1RuGJnaAqUPFXHgKxLOnhcL_amICDRWMOfZRI3T4_h",
            bytes: "0x8a140d51b86267680a943c55c780ac4b3a785c2ff6a62020d158c39f6512374f",
            id: "0xc25b710f269dfffd6f045756d330b084451c6a0db366309b7f400859a1b76db4",
        },
    }
}