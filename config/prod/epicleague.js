module.exports = {
    chain_list: [
        "eth",
        "bsc",
        "matic",
    ],

    // Bridge Addresses
    bridge_address: {
        eth: {
            vault: "0x09Ac709B11E1B7d08E8bcab0472674a9d77B13eb",
            multisig: "0x09Ac709B11E1B7d08E8bcab0472674a9d77B13eb"
        },
        bsc: {
            minter: "0x09Ac709B11E1B7d08E8bcab0472674a9d77B13eb",
            multisig: "0xbbf04C01AAA813c61525551e4d8014A2001500E3",
            admin: "0xef6D4C123078409f49037a85D3ADbcc5411DeA33"
        },
        matic: {
            minter: "0x09Ac709B11E1B7d08E8bcab0472674a9d77B13eb",
            multisig: "0xbbf04C01AAA813c61525551e4d8014A2001500E3",
            admin: "0xef6D4C123078409f49037a85D3ADbcc5411DeA33"
        },
        governance: {
            chain: "ETH",
            address: "0x09Ac709B11E1B7d08E8bcab0472674a9d77B13eb",
            bytes: "0x09Ac709B11E1B7d08E8bcab0472674a9d77B13eb",
            id: "0xd4ff2b907575ecee91528be826b644668b6017edb704f1a4fe8abb63123b75ff"
        }
    }
}