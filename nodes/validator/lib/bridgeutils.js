const bech32 = require('bech32');
const rippleAddr = require('ripple-address-codec');
const config = require(ROOT + '/config');

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

        if(toChain === "TERRA"){
            address = this.hex2str(address);
            let bech32Addr;
            try{
                bech32Addr = bech32.decode(address);
            }catch(e) {
                return false;
            }
            return (bech32Addr.prefix === 'terra' || bech32Addr.prefix === 'terravaloper') && bech32Addr.words.length === 32;
        }

        if(toChain === "ETH"){
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "KLAYTN"){
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "BSC"){
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "HECO"){
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "MATIC"){
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "ICON"){
            return (address.slice(0,4) === '0x00' || address.slice(0,4) === '0x01') && address.length == 44;
        }

        if(toChain === "ORBIT"){
            return address.slice(0,2) === '0x' && address.length == 42;
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

        return false;
    }

    padLeft(data, length) {
        return '0x' + data.replace('0x','').padStart(length,'0');
    }
}

module.exports = BridgeUtils;
