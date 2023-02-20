module.exports = {
    // operating chain list
    chain_list: [
        'klaytn',
        'orbit',
        'bsc',
        'heco',
        'matic',
    ],

    // Bridge Addresses
    bridge_address: {
        orbit_hub: "0xb5680a55d627c52de992e3ea52a86f19da475399",
        klaytn_bridge: "0x1af95905bb0042803f90e36d79d13aea6cd58969",
        orbit_bridge: "0x77a49649964a186Fd2b8754758c39c9438a6E9aB",
        bsc_bridge: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
        heco_bridge: "0xE7688F64e96A733EaDdCb5850392347e67Bb197f",
        matic_bridge: "0x1Fc5A2cE72c71563E6EFC1fc35F326D4CCd23B93",
        multisig: {
            hub: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            klaytn: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            orbit: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            bsc: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            heco: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            matic: "0x5059725ed52970725d882B7c66f613577BacaEB2",
        },
        bsc: {
            vault: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            multisig: "0xf2C5a817cc8FFaAB4122f2cE27AB8486DFeAb09F",
            admin: "0x8D5DcEab358979101dC96A62e08296269F6BD1bd",
        },
        klaytn: {
            minter: "0xB0a83941058b109Bd0543fa26d22eFb8a2D0f431",
            multisig: "0x937936FF183102Dfb1609D5dbFbC50201f92c744",
        },
        orbit: {
            minter: "0xd4EC00c84f01361F36D907E061EA652eE50572AF",
            multisig: "0x5059725ed52970725d882B7c66f613577BacaEB2",
        },
        heco: {
            minter: "0xf2C5a817cc8FFaAB4122f2cE27AB8486DFeAb09F",
            multisig: "0xE7688F64e96A733EaDdCb5850392347e67Bb197f",
            admin: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
        },
        matic: {
            minter: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            multisig: "0xf2C5a817cc8FFaAB4122f2cE27AB8486DFeAb09F",
            admin: "0x8D5DcEab358979101dC96A62e08296269F6BD1bd",
        },
        governance: {
            chain: "BSC",
            address: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            bytes: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            id: "0xa83e44c751c7b6296864c8145d325c9a9397f30adfc5a92c840fb7cb688775b3",
        },
    }
}