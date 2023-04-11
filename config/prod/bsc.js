module.exports = {
    // operating chain list
    chain_list: [
        'klaytn',
        'orbit',
        'bsc',
        'heco',
        'matic',
        'avax',
        'celo',
        'fantom',
        'moonriver',
        'oec',
        'xdai',
        'ton',
        'wemix',
        'metadium'
    ],

    // Bridge Addresses
    bridge_address: {
        orbit_hub: "0xb5680a55d627c52de992e3ea52a86f19da475399",
        klaytn_bridge: "0x1af95905bb0042803f90e36d79d13aea6cd58969",
        orbit_bridge: "0x77a49649964a186Fd2b8754758c39c9438a6E9aB",
        bsc_bridge: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
        heco_bridge: "0xE7688F64e96A733EaDdCb5850392347e67Bb197f",
        matic_bridge: "0x1Fc5A2cE72c71563E6EFC1fc35F326D4CCd23B93",
        avax_bridge: "0xc1BB90870d8b24E77DA35DFCD5122673dAFFfB45",
        celo_bridge: "0x9fae958393B59ccb5e707B274615e214c8BD0AE1",
        fantom_bridge: "0x349b3f3A4aA3F6D97bdbcCc01c77a798d2944dBF",
        moonriver_bridge: "0x554Df2f7983de38b02533F154160C120A67335A4",
        oec_bridge: "0x186541Bf5c8dF14f7C98d3A82C4620852Ac620E3",
        xdai_bridge: "0x4DBaE1d542e1747607583016A06bC9fD8B9b9a73",
        ton_bridge: "0x25605C6247fDBC95D91275025ed3dc2632936c3a",
        wemix_bridge: "0xe9b55cBE750d0DED03f599456ea68931a2b5b09A",
        metadium_bridge: "0xe6739AfDb6Bc1Abf8e1Bb3Ca25Ad320715f49904",
        multisig: {
            hub: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            klaytn: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            orbit: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            bsc: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            heco: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            matic: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            avax: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            celo: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            klaytn: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            moonriver: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            fantom: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            ton: "0x43bb191447ff7d2e1c431677d8e5e9d819fe1102",
            xdai: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            oec: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            metadium: "0x5059725ed52970725d882B7c66f613577BacaEB2",
            wemix: "0x5059725ed52970725d882B7c66f613577BacaEB2"
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
        avax: {
            minter: "0xC91D164267De757fe7f5569868dc2a1Ca363c136",
            multisig: "0xD5afF4221b353Ab0A3dd6ad7C1FB97e582DC0C9c",
            admin: "0xe1bbfc002714bede0f9ee84e5d1cb4cf3a3a9e75"
        },
        celo: {
            minter: "0x9DC1cb0a52fC34659D18B0F31e26582a8Db609b5",
            multisig: "0xDf4f362E6C3Baa3Fc8Fb0179498e6c80c35Cf547",
            admin: "0xa37581EDC6135585287675Ee6E517897E3c42D38"
        },
        fantom: {
            minter: "0xf426e8BdE6f123610C463cec039134Fee2a7D297",
            multisig: "0xE1BbFC002714bEDE0F9EE84E5D1Cb4cF3A3a9e75",
            admin: "0xF172E1A0821C391E8Efc407822F970b4D0474ba8"
        },
        moonriver: {
            minter: "0x9DC1cb0a52fC34659D18B0F31e26582a8Db609b5",
            multisig: "0xDf4f362E6C3Baa3Fc8Fb0179498e6c80c35Cf547",
            admin: "0xa37581EDC6135585287675Ee6E517897E3c42D38"
        },
        oec: {
            minter: "0x9DC1cb0a52fC34659D18B0F31e26582a8Db609b5",
            multisig: "0xDf4f362E6C3Baa3Fc8Fb0179498e6c80c35Cf547",
            admin: "0xa37581EDC6135585287675Ee6E517897E3c42D38"
        },
        ton: {
            minter: "EQDABRjlDIBMx_BTNp-TvVjQZXjqfxq2y50jmhyZSJ58bB0R",
            multisig: "EQAs_E5Ta00Oo5gBoAevL4npbZLLOFZuvptpUeSdRnFK6mFG",
        },
        xdai: {
            minter: "0x9DC1cb0a52fC34659D18B0F31e26582a8Db609b5",
            multisig: "0xDf4f362E6C3Baa3Fc8Fb0179498e6c80c35Cf547",
            admin: "0xa37581EDC6135585287675Ee6E517897E3c42D38"
        },
        wemix: {
            minter: "0xfe4a11ec60A52A5593649510f249FEbE14Ad4e70",
            multisig: "0x3F4D41077dA83d6A57d8d0Cd692cd49C997bCE4F",
            admin: "0xcCED7af08E3E37e5C822412E0CaEE1Fb99cCB4d1"
        },
        metadium: {
            minter: "0x9DC1cb0a52fC34659D18B0F31e26582a8Db609b5",
            multisig: "0xDf4f362E6C3Baa3Fc8Fb0179498e6c80c35Cf547",
            admin: "0xa37581EDC6135585287675Ee6E517897E3c42D38"
        },
        governance: {
            chain: "BSC",
            address: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            bytes: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            id: "0xa83e44c751c7b6296864c8145d325c9a9397f30adfc5a92c840fb7cb688775b3",
        },
    }
}