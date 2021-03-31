const crypto = require('crypto');
const addressCodec = require('ripple-address-codec');
const bs58 = require('bs58');
const varuint = require('varuint-bitcoin');
const ethUtil = require('ethereumjs-util');
const codec = require('ripple-binary-codec');
const keypairs = require('ripple-keypairs');
const ripple = require('./ripple.api');
const EC = require('elliptic').ec;
const secp256k1 = new EC('secp256k1');

let context = null;

class XrpBridge {
    constructor(network) {
        context = this;
    }

    getLength(str) {
        if (!str) {
            throw new TypeError('The parameter is empty.');
        }

        let len = 0;
        if (Buffer.isBuffer(str)) {
            str = str.toString('hex');
        }

        switch (typeof str) {
            case 'string':
                len = parseInt(str.length / 2);
                break;
            case 'number':
                len = parseInt(str);
                break;
            default:
                throw new TypeError('The parameter must be a string or a number');
        }
        return len;
    }

    getLengthHex(str) {
        let len = this.getLength(str);

        return varuint.encode(len).toString('hex');
    }

    toDER(x) {
        let buf = x;
        if (!Buffer.isBuffer(buf))
            buf = Buffer.from(x.replace('0x', ''), 'hex');

        const ZERO = Buffer.alloc(1, 0);
        let i = 0;
        while (buf[i] === 0) ++i;
        if (i === buf.length) return ZERO;
        buf = buf.slice(i);
        if (buf[0] & 0x80) return Buffer.concat([ZERO, buf], 1 + buf.length);
        return buf;
    }

    async generatePaymentTx(from, to, tag, drops, memos, quorum) {
        if (!from)
            throw 'Source address is invalid.';
        if (!to)
            throw 'Destination address is invalid.';
        if (!drops)
            throw 'amount(drops) is invalid.';

        let payment = {
            source: {
                address: from,
                maxAmount: {
                    value: drops.toString(),
                    currency: 'drops'
                }
            },
            destination: {
                address: to,
                amount: {
                    value: drops.toString(),
                    currency: 'drops'
                }
            }
        }

        if (tag)
            payment.destination.tag = parseInt(tag);

        if (memos)
            payment.memos = memos;

        let tx = await ripple.preparePayment(from, payment);

        if (tx) {
            let json = JSON.parse(tx.txJSON);
            if (json) {
                json.Fee = parseFloat(json.Fee);

                quorum = parseInt(quorum);
                if (!Number.isNaN(quorum) && quorum > 0) {
                    json.SigningPubKey = '';
                    json.Fee = parseFloat(json.Fee) * (1 + quorum);
                }

                json.Fee = (json.Fee).toString();
                delete json.LastLedgerSequence;
            }

            tx.txJSON = json;
        }

        return tx;
    }

    getAddress(pubKey) {
        return keypairs.deriveAddress(pubKey);
    }

    getKeyPair(pk) {
        let keyPair = {privateKey: pk};
        pk = null;

        keyPair.publicKey = secp256k1.keyFromPrivate(pk);
        keyPair.address = this.getAddress(keyPair.publicKey);

        return keyPair;
    }

    recoverPubKey(hash, v, r, s) {
        v = Number(v);

        if (Number.isNaN(v))
            v = 0;
        else if (v >= 27)
            v -= 27;

        hash = Buffer.from(hash.replace('0x', ''), 'hex');
        if (typeof r === 'string') {
            r = Buffer.from(r.replace('0x', ''), 'hex');
        }
        if (typeof s === 'string') {
            s = Buffer.from(s.replace('0x', ''), 'hex');
        }

        let xy = secp256k1.recoverPubKey(hash, {r, s}, v);
        return xy.encodeCompressed('hex');
    }

    getRawMultisigTx(txJson, signerAddress) {
        return this.encodeTxMultisig(txJson, signerAddress, true);
    }

    getSignatureHash(rawOrTxObject, signerAddress) {
        let rawTx = rawOrTxObject;
        if (typeof rawTx !== 'string' && typeof rawTx === 'object') {
            if (!rawTx.TransactionType)
                throw 'Invalid transaction object.';

            rawTx = this.getRawMultisigTx(rawTx, signerAddress)
        }

        let signingData = Buffer.from(rawTx, 'hex').toJSON().data;
        let hash = crypto.createHash('sha512').update(Buffer.from(signingData)).digest('hex');

        return hash.slice(0, 64);
    }

    getTxnSignature(r, s) {
        let sig = `02${this.getLengthHex(r)}${r}02${this.getLengthHex(s)}${s}`;
        sig = `30${this.getLengthHex(sig)}${sig}`;

        return sig;
    }

    ecsign(hash, pk) {
        if (!Buffer.isBuffer(hash))
            hash = Buffer.from(hash.replace('0x', ''), 'hex');
        if (!Buffer.isBuffer(pk))
            pk = Buffer.from(pk.replace('0x', ''), 'hex');

        let vrs = ethUtil.ecsign(hash, pk);
        pk = null;

        return {
            v: vrs.s,
            r: '0x' + vrs.r.toString('hex'),
            s: '0x' + vrs.s.toString('hex')
        }
    }

    getSerializedTx(txJson, signatureObject) {
        let tx = txJson;
        tx.SigningPubKey = '';

        let signer = {
            Account: signatureObject.account,
            SigningPubKey: signatureObject.publicKey.toUpperCase(),
            TxnSignature: signatureObject.txnSignature.toUpperCase()
        };

        tx.Signers = [{Signer: signer}];

        let serialized = codec.encode(tx);
        return serialized;
    }

    getAddressToHex(address, isBtcDigit) {
        let bytes = isBtcDigit ? bs58.decode(address) : addressCodec.codec.codec.decode(address);
        return '0x' + Buffer.from(bytes).toString('hex');
    }

    getAddressFromHex(hex, isBtcDigit) {
        let buf = Buffer.from(hex.replace('0x', ''), 'hex');
        return isBtcDigit ? bs58.encode(buf) : addressCodec.codec.codec.encode(buf);
    }

    encodeTxMultisig(txJson, signAs) {
        if (!signAs)
            throw 'signAs is not defined.';

        if (typeof txJson === 'string')
            txJson = JSON.parse(txJson);

        let hex = codec.encodeForMultisigning(txJson, signAs);

        return hex;
    }

    getReleaseMemo(govId, swapIndex) {
        let memos = [];

        memos.push({
            Memo: {
                MemoData: this.string2hex(swapIndex.toString()).toUpperCase(),
                MemoType: this.string2hex('swapIndex').toUpperCase()
            }
        });

        memos.push({
            Memo: {
                MemoData: this.string2hex(govId).toUpperCase(),
                MemoType: this.string2hex('govId').toUpperCase()
            }
        });

        return memos
    }

    string2hex(str) {
        var hex = '';
        for (var i = 0; i < str.length; i++) {
            hex += str.charCodeAt(i).toString(16);
        }

        return hex;
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

        if(toChain === "ORBIT"){
            return address.slice(0,2) === '0x' && address.length == 42;
        }

        if(toChain === "XRP"){
            try{
                let buf = Buffer.from(address.replace('0x', ''), 'hex');
                address = addressCodec.codec.codec.encode(buf);
            }catch(e) {
                return false;
            }

            return addressCodec.isValidClassicAddress(address) || addressCodec.isValidXAddress(address);
        }

        return false;
    }

    padLeft(data, length) {
        return '0x' + data.replace('0x','').padStart(length,'0');
    }
}

module.exports = XrpBridge;
