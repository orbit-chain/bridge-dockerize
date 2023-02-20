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
        'eth',
        'stacks',
        'ton'
    ],

    // Bridge Addresses
    bridge_address: {
        orbit_hub: "0xb5680a55d627c52de992e3ea52a86f19da475399",
        bsc_bridge: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
        heco_bridge: "0xE7688F64e96A733EaDdCb5850392347e67Bb197f",
        klaytn_bridge: "0x1af95905bb0042803f90e36d79d13aea6cd58969",
        orbit_bridge: "0x77a49649964a186Fd2b8754758c39c9438a6E9aB",
        stacks_bridge: "0x77d50F8e3A95DC0FE71057E54E4Ee9C86147d861",
        ton_bridge: "0x25605C6247fDBC95D91275025ed3dc2632936c3a",
        multisig: {
            hub: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            orbit: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            avax: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            bsc: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            celo: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            fantom: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            harmony: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            heco: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            klaytn: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            matic: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            moonriver: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            oec: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            stacks: "0x225a23428FEb303F3821C90ceA8e35C612260a42",
            ton: "0x43aE0689156d644f4b1De4a75a4586867A9d3CF0",
            xdai: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
        },
        avax: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        bsc: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        celo: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        eth: {
            minter: "0x012c6d79b189e1aBD1EFaC759b275c5D49Abd164",
            multisig: "0x9Abc3F6c11dBd83234D6E6b2c373Dfc1893F648D",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        fantom: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        harmony: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        heco: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        klaytn: {
            vault: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
        },
        matic: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        moonriver: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        oec: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        stacks: {
			deploy_address: "SP2JWSZAKDEVADF2FADKS0DF8S01CY5WP61YXAV71",
			multisig: "gov-matic",
			"0x0000000000000000000000000000000000000000": "orbit-klay",
			"0xc6a2ad8cc6e4a7e08fc37cc5954be07d499e7654": "orbit-ksp",
        },
        ton: {
            TonMinterContract: "EQAlMRLTYOoG6kM0d3dLHqgK30ol3qIYwMNtEelktzXP_pD5",
            MessageMultiSigWallet: "EQAblz6Xr6b-7eLAWeagIK2Dn-g81YiNpu0okHfc9EwY9_72",
        },
        xdai: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
            admin: "0x3060E2fbDB75663b50bf9e629693DC39A4418736",
        },
        orbit: {
            minter: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            multisig: "0xcAA1B50341ad8Eb69A7bb1985bf39224044B1d48",
        },
        governance: {
            chain: "KLAYTN",
            address: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            bytes: "0x9abc3f6c11dbd83234d6e6b2c373dfc1893f648d",
            id: "0xf8e356a0087a537f3e1a481c46ed4bdc4438723ebe666d8a3e7e6f4021d740a4",
        },
    }
}