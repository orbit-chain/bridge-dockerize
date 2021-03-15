const CryptoJS = require('crypto-js');
const terra = require('./terra.api');
const EC = require('elliptic').ec;
const secp256k1 = new EC('secp256k1');
const config = require(ROOT + '/config');
const bech32 = require('bech32');

let context = null;

class TerraBridgeUtils {
    constructor(network) {
        context = this;
    }

    recoverPubKey(hash, v, r, s) {
        v = Number(v);

        if (Number.isNaN(v))
            v = 0;
        else if (v >= 27)
            v -= 27;

        hash = Buffer.from(hash.replace('0x', ''), 'hex');

        let xy = secp256k1.recoverPubKey(hash, {r, s}, v);
        return xy.encodeCompressed('hex');
    }


    createSignMessage(stdTxValue, sequence, accountNumber) {
        // sign bytes need amount to be an array
        const fee = {
            amount: stdTxValue.fee.amount || [],
            gas: stdTxValue.fee.gas
        };

        return JSON.stringify(
            prepareSignBytes({
                fee: fee,
                memo: stdTxValue.memo,
                msgs: stdTxValue.msg,
                sequence: sequence,
                account_number: accountNumber,
                chain_id: config.terra.chainId
            })
        )
    }

    getSignatureHash(stdTx, sequence, accountNumber) {
        const message = this.createSignMessage(stdTx.value, sequence, accountNumber);
        return Buffer.from(CryptoJS.SHA256(message).toString(), 'hex');
    }

    createSignature(hash, vrs, sequence, accountNumber) {
        vrs.v = Number(vrs.v.replace('0x', ''));
        vrs.r = vrs.r.replace('0x', '');
        vrs.s = vrs.s.replace('0x', '');

        let signature = Buffer.concat([Buffer.from(vrs.r, 'hex'), Buffer.from(vrs.s, 'hex')]);
        let publicKey = this.recoverPubKey(hash, vrs.v, vrs.r, vrs.s);

        return {
            signature: signature.toString('base64'),
            pub_key: {
                type: 'tendermint/PubKeySecp256k1',
                value: Buffer.from(publicKey, 'hex').toString('base64')
            },
            // sequence: sequence,
            // account_number: accountNumber
        }
    }

    getAddressToHex(terraAddress) {
        return '0x' + Buffer.from(terraAddress).toString('hex');
    }

    getAddressFromHex(hex) {
        hex = hex || '';
        return Buffer.from(hex.replace('0x', ''), 'hex').toString('utf8');
    }

    getFeeObject({gas, fee, tax, feeDenom = 'ukrw', taxDenom = 'ukrw'}) {
        if (!fee) {
            fee = (Math.ceil(gas * config.terra.gasPrices[feeDenom])).toString();
        }

        let res = {
            gas: gas.toString(),
            amount: [{
                amount: fee,
                denom: feeDenom,
            }]
        }

        if(taxDenom === feeDenom){
            res.amount[0].amount = (parseInt(res.amount[0].amount) + parseInt(tax)).toString();
        }
        else if(taxDenom !== "uluna"){
            res.amount.push({amount: tax.toString(), denom: taxDenom});
        }

        return res;
    }

    async calculateTax(denom, amount) {
        if(denom === 'uluna')
            return '0';

        let taxInfo = await terra.getTaxInfo(denom);
        if(Number.isNaN(Number(taxInfo.taxRate)) || Number.isNaN(Number(taxInfo.taxCap)))
            return;

        let rate = taxInfo.taxRate.toString().dmove(18);
        let _amount = amount.dmove(36).ddiv(rate.dadd('1'.dmove(18))).dmove(-18).dprec(0); // realAmount = amount / (rate + 1)
        let tax = _amount.dmul(rate).dmove(-18).dprec(0); // tax = realAmount * rate

        // calculate tax by rate > tax cap
        if (taxInfo.taxCap.toString().dcomp(tax) === -1)
            tax = taxInfo.taxCap;

        if (tax.toString().dcomp('1') === -1)
            tax = '0';

        return tax;
    }

    isTerraAddress(address) {
        if (!address)
            return false;

        let bech32Addr;
        try{
            bech32Addr = bech32.decode(address);
        }catch(e) {
            return false;
        }

        return (bech32Addr.prefix === 'terra' || bech32Addr.prefix === 'terravaloper') && bech32Addr.words.length === 32;
    }

    getErrorMemo(errorCode) {
        return 'Err:' + errorCode.toString();
    }

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

        if(toChain === "ICON"){
            return (address.slice(0,4) === '0x00' || address.slice(0,4) === '0x01') && address.length == 44;
        }

        return false;
    }

    padLeft(data, length) {
        return '0x' + data.replace('0x','').padStart(length,'0');
    }
}

// Transactions often have amino decoded objects in them {type, value}.
// We need to strip this clutter as we need to sign only the values.
function prepareSignBytes(jsonTx) {
    if (Array.isArray(jsonTx)) {
        return jsonTx.map(prepareSignBytes)
    }

    // string or number
    if (typeof jsonTx !== `object`) {
        return jsonTx
    }

    const sorted = {};
    Object.keys(jsonTx)
        .sort()
        .forEach(key => {
            if (jsonTx[key] === undefined || jsonTx[key] === null)
                return;

            sorted[key] = prepareSignBytes(jsonTx[key])
        });

    return sorted;
}


module.exports = TerraBridgeUtils;
