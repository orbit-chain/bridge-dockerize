let walletApi = require('ethereumjs-wallet');
let ethUtil = require('ethereumjs-util');
let hdKey = require('ethereumjs-wallet/hdkey');
let fs = require('fs');
let Web3 = require('web3');
const web3 = new Web3();
const path = require('path');
const readline = require('readline-sync');

class WalletUtil {
    static getKeystoreJSON(keyPath) {
        keyPath = keyPath || path.resolve() + '/keystore.json';

        let file = null;

        try {
            file = fs.readFileSync(keyPath, 'utf8');
        } catch (e) {
            throw e;
        }

        let json = {};
        try {
            json = JSON.parse(file);
        } catch (e) {
            throw e;
        }

        if (!json)
            throw 'No JSON type keystore.';

        if (json.Crypto)
            json.crypto = json.Crypto;

        return json;
    }

    static getWallet(keystore, password) {
        let wallet = walletApi.fromV3(keystore, password);
        return {
            address: wallet.getAddressString(),
            addressBuffer: wallet.getAddress(),
            pk: wallet.getPrivateKey().toString('hex'),
            pkBuffer: wallet.getPrivateKey()
        }
    }

    static getWalletFromPK(pk) {
        let wallet = walletApi.fromPrivateKey(pk);
        return {
            address: wallet.getAddressString(),
            addressBuffer: wallet.getAddress(),
            pk: wallet.getPrivateKey().toString('hex'),
            pkBuffer: wallet.getPrivateKey()
        }
    }
    static makeWallet(seed, password, encryptCount) {
        let wallet = hdKey.fromMasterSeed(seed).getWallet();

        return wallet.toV3(password, {
            n: encryptCount || 8192
        });
    }

    static migrateWallet(pk, password, encryptCount) {
        pk = pk.replace('0x', '');

        if (pk === '') {
            let newaccount = web3.eth.accounts.create(web3.utils.randomHex(32));
            pk = newaccount.privateKey;
            if (password === ''){
                console.log(newaccount.address, pk);
                process.exit(0);
            }
        }
        let pkBuffer = ethUtil.toBuffer('0x' + pk.replace('0x', ''));
        let wallet = walletApi.fromPrivateKey(pkBuffer);

        return wallet.toV3(password, {
            n: encryptCount || 8192
        });
    }
}

if (process.argv[1].indexOf('wallet') !== -1) {
    let argvAccount = getAccountFromParams();
    if (argvAccount) {
        let keystore = WalletUtil.migrateWallet(argvAccount.pk, argvAccount.pw);
        let address = keystore.address;
        let filename = `keystore_${address}.json`;

        fs.writeFileSync('./' + filename, JSON.stringify(keystore), 'utf8');
        console.log('Keystore file saved: ' + filename);
    }
}

function getAccountFromParams() {
    if (process.argv.length < 2)
        return null;

    let pk = process.argv[2];
    let pw = process.argv[3];

    if (pk.length === 66) {
        pk = pk.replace('0x', '');
    } else if (pk === 'load') {
        let kpw = readline.question('Password: ', {
            hideEchoBack: true
        });
        try {
            console.log(WalletUtil.getWallet(WalletUtil.getKeystoreJSON(pw), kpw));
            process.exit(0);
        } catch (e) {
            console.log(e);
        }
    } else if (pk === '0x') {
        return {
            pk:'',
            pw:''
        }
    } else if (pk === 'new') {
        pk = ''
    } else if (pk.length !== 64) {
        throw 'Account private key must be 32Byte Hex.'
    }

    if (!pw || pw.length == 0) {

        pw = readline.question('Password: ', {
            hideEchoBack: true
        });
        if (pw.length == 0) {
            throw 'Password length muse be bigger than 1';
        }
    }

    return {
        pk: pk,
        pw: pw
    }
}

module.exports = WalletUtil;