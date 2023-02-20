const bech32 = require('bech32');
const rippleAddr = require('ripple-address-codec');
const config = require(ROOT + '/config');
const Endpoints = config.endpoints.endpoints;
const { AddressVersion, addressFromVersionHash, addressToString } = require("@stacks/transactions");
const request = require("request-promise");

class BridgeUtils {
    str2hex(input){
        if (typeof(input) !== 'string'){
            return "";
        }

        if (input.length < 2 || input.slice(0,2) !== '0x'){
            return '0x' + Buffer.from(input).toString('hex');
        }

        return input;
    }

    hex2str(input){
        input = input || ''
        return Buffer.from(input.replace('0x', ''), 'hex').toString('utf8');
    }

    isValidData(toChain, data) {
        if (!toChain)
            return false;

        if (!data)
            return false;

        if (toChain === "XRP"){
            return data === "0x" || parseInt(data) <= 4294967295;
        }

        return true;
    }

    isValidAddress(toChain, address) {
        if (!address)
            return false;

        if (!toChain)
            return false;

        const EVM_CHAINS = [
            "ETH",
            "KLAYTN",
            "BSC",
            "HECO",
            "MATIC",
            "CELO",
            "AVAX",
            "FANTOM",
            "HARMONY",
            "MOONRIVER",
            "OEC",
            "XDAI",
            "ORBIT",
        ]

        if (EVM_CHAINS.includes(toChain)) {
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "ICON"){
            let govInfo = config.governance;
            if(govInfo.chain === "ICON" && address.toLowerCase() === govInfo.bytes.toLowerCase()){
                return false;
            }

            return (address.slice(0,4) === '0x00' || address.slice(0,4) === '0x01') && address.length == 44;
        }

        if(toChain === "XRP"){
            let govInfo = config.governance;

            try{
                let buf = Buffer.from(address.replace('0x', ''), 'hex');
                address = rippleAddr.codec.codec.encode(buf);
            }catch(e) {
                return false;
            }

            return rippleAddr.isValidClassicAddress(address) && govInfo.chain === "XRP" && address.toLowerCase() !== govInfo.address.toLowerCase();
        }

        if (toChain.includes("STACKS")) {
            if(address.length != 42) {
                return false;
            }

            let addr;
            try {
                if(Endpoints.stacks.network === "testnet"){
                    addr = addressToString(addressFromVersionHash(AddressVersion.TestnetSingleSig, address.replace("0x", "")));
                    return addr.slice(0,2) === "ST";
                }
                else{
                    addr = addressToString(addressFromVersionHash(AddressVersion.MainnetSingleSig, address.replace("0x", "")));
                    return addr.slice(0,2) === "SP";
                }
            } catch(e) {
                return false;
            }
        }

        return false;
    }

    padLeft(data, length) {
        return '0x' + data.replace('0x','').padStart(length,'0');
    }

    async getBeaconBlock() {
        const info = config.info.eth;
        if(!info) return;

        const beacon = info.ENDPOINT.beacon || "https://beacon.chain-node.orbitchain.io:7643";
        let res;
        try {
            res = await request.get(`${beacon}/eth/v2/beacon/blocks/finalized`);
            res = JSON.parse(res);
        } catch (e) {console.log(e);}

        return res;
    }
}

module.exports = BridgeUtils;
