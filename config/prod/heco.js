module.exports = {
    chain_list: [
        'avax',
        'bsc',
        'celo',
        'heco',
        'fantom',
        'harmony',
        'klaytn',
        'matic',
        'moonriver',
        'orbit',
        'oec',
        'xdai',
    ],

    // Bridge Addresses
    bridge_address: {
        orbit_hub: "0xb5680a55d627c52de992e3ea52a86f19da475399",
        bsc_bridge: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
        heco_bridge: "0xE7688F64e96A733EaDdCb5850392347e67Bb197f",
        klaytn_bridge: "0x1af95905bb0042803f90e36d79d13aea6cd58969",
        orbit_bridge: "0x77a49649964a186Fd2b8754758c39c9438a6E9aB",
        multisig: {
            hub: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            orbit: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            avax: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            bsc: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            celo: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            fantom: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            harmony: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            heco: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            klaytn: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            matic: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            moonriver: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            oec: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            xdai: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
        },
        avax: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        bsc: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        celo: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        fantom: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        harmony: {
            minter: "0x7112999b437404B430acf80667E94D8E62b9e44E",
            multisig: "0x11F91b08469f77cf47d2d829B4230E9268e9E670",
            admin: "0x6CADF5FCD6D2930F6885725b5CCd060eaD9c1963",
        },
        heco: {
            vault: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        klaytn: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
        },
        matic: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        moonriver: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        oec: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        xdai: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
            admin: "0x2bA5049df54aEde8d26786DFBE0cf0fDF7eDBBAd",
        },
        orbit: {
            minter: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            multisig: "0x8B8B037CC309bf46E23226BF38BE433ABC284Cf6",
        },
        governance: {
            chain: "HECO",
            address: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            bytes: "0x38C92A7C2B358e2F2b91723e5c4Fc7aa8b4d279F",
            id: "0x1958c3d245eed5312fa97ca358876d36b45c0905dd322b73efd66c8f836fb67f",
        },
    }
}