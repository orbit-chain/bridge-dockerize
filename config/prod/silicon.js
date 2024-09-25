module.exports = {
    // operating chain list
    chain_list: [
        'silicon',
        'klaytn',
        'icon',
        'avax',
        'bsc',
        'matic',
        'ton',
        'wemix'
    ],

    // Bridge Addresses
    bridge_address: {
        silicon: {
            vault: "0x5aAAcf28ECDd691b4a657684135d8848d38236Bb",
			multisig: "0x67fAD8dd49abcc129DC25DE15bA1D3994F748AE5",
			admin: "0x3A054a90be288B75AEfa540f9Fff9B63d048dE5b"
        },
        avax: {
            minter: "0x6BD8E3beEC87176BA9c705c9507Aa5e6F0E6706f",
            multisig: "0xFA9c34485c3a706725130E8e0217431AC000E31e",
            admin: "0xe62Fa6C59AD14B46d4e7791FA817030732953b79",
        },
        bsc: {
            minter: "0x6BD8E3beEC87176BA9c705c9507Aa5e6F0E6706f",
            multisig: "0xFA9c34485c3a706725130E8e0217431AC000E31e",
            admin: "0xe62Fa6C59AD14B46d4e7791FA817030732953b79",
        },
        icon: {
            minter: "cx0eb215b6303142e37c0c9123abd1377feb423f0e",
            multisig: "cxa032c913d5d9b7577e2b19f39d91985e5c260577",
        },
        klaytn: {
            minter: "0x60070F5D2e1C1001400A04F152E7ABD43410F7B9",
            multisig: "0x74bB62c446c592a5A8424d4f9437242df1e26BF0",
        },
        matic: {
            minter: "0x6BD8E3beEC87176BA9c705c9507Aa5e6F0E6706f",
            multisig: "0xFA9c34485c3a706725130E8e0217431AC000E31e",
            admin: "0xe62Fa6C59AD14B46d4e7791FA817030732953b79",
        },
        ton: {
            minter: "EQAihs8RdUgLANjNypV5LgaUHfdoUsMVL5o06K2F-qFSki00",
            multisig: "EQBbAqI1eVJ8PbZpKXA5njk6hq8Q6ZUxwXLZf-ntG1wf90Tm",
        },
        wemix: {
            minter: "0x6BD8E3beEC87176BA9c705c9507Aa5e6F0E6706f",
            multisig: "0xCeBB82777bfe09c65AA47E8dD09a2f3972467901",
            admin: "0xe62Fa6C59AD14B46d4e7791FA817030732953b79",
        },
        governance: {
            chain: "SILICON",
            address: "0x5aAAcf28ECDd691b4a657684135d8848d38236Bb",
            bytes: "0x5aAAcf28ECDd691b4a657684135d8848d38236Bb",
            id: "0xaf3aa751581952cd44ce699915c6a0dd1b5df9b832505b2629420e87d1ddf981",
        },
    }
}