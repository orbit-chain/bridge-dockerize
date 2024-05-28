module.exports = {
    // operating chain list
    chain_list: [
        'celo',
        'klaytn',
    ],

    // Bridge Addresses
    bridge_address: {
        klaytn: {
            minter: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            multisig: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
        },
        celo: {
            vault: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            multisig: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
            admin: "0x6a1cf2e4b8DF2C2707e34cad35D8AF4535510F53",
        },
        governance: {
            chain: "CELO",
            address: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            bytes: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            id: "0x6c09d7b79b91a3d49c3648a1bbc811f1b99f16045218e72a597a7692580ccab1",
        },
    }
}