module.exports = {
    // operating chain list
    chain_list: [
        "eth",
        "klaytn",
        "avax",
        "bsc",
        "matic",
        "metadium",
        "ton",
        "wemix",
        "silicon",
    ],

    // Bridge Addresses
    bridge_address: {
        avax: {
            minter: "0x81aB59F77cdb158d4A9DcF66d5e04E6e277a0a43",
            multisig: "0x56D9c7A23CBaf1442fBDaAA3B97502f089cfecbF",
            admin: "0x86c462C9F64347FC1b1aA43eE5dcBCEFc0Ca5514"
        },
        bsc: {
            minter: "0xeA74a390Df39080c417DA23023cAa84f6Bb28568",
            multisig: "0x41A307A2EEC05d7E8BbA452c1D061398bE29e4f6",
            admin: "0x81aB59F77cdb158d4A9DcF66d5e04E6e277a0a43"
        },
        eth: {
            minter: "0x34c51c0cD541CAddcb71dB298Ec9fAf6D0256808",
            multisig: "0x381A07875D7C346E024cF4a9C46616154dFd1ea5",
            admin: "0x8e2cFeb906b293b329d3017eB55faff0EA0C6FF4"
        },
        klaytn: {
            minter: "0x3be51C9F0584Cc24eA330665010d69a21edee240",
            multisig: "0x4A6A0c1b6452a3a4adB5F095A65BE59Eb1edd3dD"
        },
        matic: {
            minter: "0xb5f76BDd8383A079a31381DcD5205Bf221B6476e",
            multisig: "0x3f5beBAf2A10326e5aB91777a0E23E2b68E4A17c",
            admin: "0x4A6A0c1b6452a3a4adB5F095A65BE59Eb1edd3dD"
        },
        metadium: {
            minter: "0xeA74a390Df39080c417DA23023cAa84f6Bb28568",
            multisig: "0x41A307A2EEC05d7E8BbA452c1D061398bE29e4f6",
            admin: "0x81aB59F77cdb158d4A9DcF66d5e04E6e277a0a43"
        },
        ton: {
            minter: "EQA4XgASzx1VSi6T0r8tv1XdHwfUEplQhjg1q09RUd8gcPhd",
            multisig: "EQAj33y_sRp4Ypuz8zdSGfrhYdTgW1uLhjVHuUNBNxnOA1RW",
        },
        wemix: {
            vault: "0x445F863df0090f423A6D7005581e30d5841e4D6d",
            multisig: "0x775b772Bd879931433C95047aF46113E97083614",
            admin: "0x9CE4E2B920DdEe58158704A47650a13123907749"
        },
        silicon: {
            minter: "0xc8ab468c4F94E954acC2D60a328DEd74bF315CB6",
            multisig: "0xe938Ff16C04C06E04AEF710F7682b437D9d47065",
            admin: "0x18d8037c2F2af01B5eA232175E051910C0d01812"
        },
        governance: {
            chain: "WEMIX",
            address: "0x445F863df0090f423A6D7005581e30d5841e4D6d",
            bytes: "0x445F863df0090f423A6D7005581e30d5841e4D6d",
            id: "0x186eb827d7996bd507fef5bd466a5348258c6a0b0dcaeed907df7699579f363c"
        }
    }
}