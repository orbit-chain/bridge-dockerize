module.exports = {
    // operating chain list
    chain_list: [
        'celo',
        'klaytn',
        'orbit',
    ],

    // Bridge Addresses
    bridge_address: {
        orbit_hub: "0xb5680a55d627c52de992e3ea52a86f19da475399",
        klaytn_bridge: "0x1af95905bb0042803f90e36d79d13aea6cd58969",
        celo_bridge: "0x9fae958393B59ccb5e707B274615e214c8BD0AE1",
        orbit_bridge: "0x77a49649964a186Fd2b8754758c39c9438a6E9aB",
        multisig: {
            hub: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
            klaytn: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
            celo: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
            orbit: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7"
        },
        klaytn: {
            minter: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            multisig: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
        },
        celo: {
            vault: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            multisig: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
            admin: "0x6a1cf2e4b8DF2C2707e34cad35D8AF4535510F53",
        },
        orbit: {
            minter: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            multisig: "0xE665028E06Cab79928D8e607E0de99FfD7Eb76A7",
        },
        governance: {
            chain: "CELO",
            address: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            bytes: "0x979cD0826C2bf62703Ef62221a4feA1f23da3777",
            id: "0x6c09d7b79b91a3d49c3648a1bbc811f1b99f16045218e72a597a7692580ccab1",
        },
    }
}