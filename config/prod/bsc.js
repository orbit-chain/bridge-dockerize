module.exports = {
    // operating chain list
    chain_list: [
        'klaytn',
        'bsc',
        'eth',
        'matic',
        'avax',
        'ton',
        'wemix',
        'metadium',
        'silicon',
    ],

    // Bridge Addresses
    bridge_address: {
        bsc: {
            vault: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            multisig: "0xf2C5a817cc8FFaAB4122f2cE27AB8486DFeAb09F",
            admin: "0x8D5DcEab358979101dC96A62e08296269F6BD1bd",
        },
        klaytn: {
            minter: "0xB0a83941058b109Bd0543fa26d22eFb8a2D0f431",
            multisig: "0x937936FF183102Dfb1609D5dbFbC50201f92c744",
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
        eth: {
            minter: "0x166E514c465EF0DB69246e14C6bA866F91B1e061",
            multisig: "0x3DE5098FBdb858567542A949B1CE22C61eae14FB",
            admin: "0xE3b4270592E217d1122ddCAeBa22Ac415D718A39",
        },
        ton: {
            minter: "EQDABRjlDIBMx_BTNp-TvVjQZXjqfxq2y50jmhyZSJ58bB0R",
            multisig: "EQAs_E5Ta00Oo5gBoAevL4npbZLLOFZuvptpUeSdRnFK6mFG",
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
        silicon: {
            minter: "0xE82b8C388E0bcF7C01D05B2cE678f6d012c9B7D9",
            multisig: "0xFf46d621318Dcaf14f09cc7A50a68230f3562e11",
            admin: "0x406134c9B11dcc132d4cB810D283FbE6E31874De",
        },
        governance: {
            chain: "BSC",
            address: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            bytes: "0x89c527764f03BCb7dC469707B23b79C1D7Beb780",
            id: "0xa83e44c751c7b6296864c8145d325c9a9397f30adfc5a92c840fb7cb688775b3",
        },
    }
}