let Tx = require('ethereumjs-tx');
let txutils = require('./txutils');

class Txsender {
    static sendTransaction(nodeConfig, txData, sender, callback) {
        let web3 = nodeConfig.web3;

        if (!Buffer.isBuffer(sender.pk))
            sender.pk = Buffer.from(sender.pk, 'hex');

        let _this = this;
        return new Promise((resolve, reject) => {
            if(!txData || !txData.method || !txData.args || !txData.options)
                return logger.error('Invalid transaction data.');
            if(!sender || !sender.address || !sender.pk)
                return logger.error('Invalid transaction sender');

            let rawTx = txutils.functionTx(nodeConfig.abi, txData.method, txData.args, txData.options);

            let timeout = (isNaN(parseInt(sender.timeout)))? 5000 : sender.timeout;

            setTimeout(async () => {
                let nonce = await _this.getWeb3Nonce(nodeConfig.web3, sender.address).catch(e => {
                    logger.error('sendTransaction getNonce error');
                    logger.error(e);
                });

                if(!nonce)
                    return;

                let tx = new Tx(rawTx);
                tx['nonce'] = sender.nonce || nonce;
                try {
                    tx.sign(sender.pk);
                } catch (e) {
                    logger.error(`Cannot Sign transaction by PK(${sender.pk}))`);
                    return;
                }

                let serializedTx = tx.serialize();

                logger.info('----------------[' + (nodeConfig.peggingType || '---') + ']----------------');
                logger.info(`Send ${(txData.method || 'Unknown')}(${txData.block || ''}) Transaction`);
                if (txData.info) logger.info(`Info : ${txData.info}`)
                logger.info(`GasPrice : ${Number(txData.options.gasPrice)}`);

                web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
                    .once('transactionHash', thash => {
                        if (callback)
                            callback(thash);

                        resolve(thash);
                        logger.info('Transaction sent : ' + thash);
                        logger.info('Transaction nonce: ' +  (Number(sender.nonce || nonce)));
                        logger.info('-------------------------------------');
                    })
                    .once('error', e => {
                        logger.error(`Fail to send ${txData.method} transaction(${Number(sender.nonce || nonce)}): ${e.message}`);
                        resolve(e.message);
                    });
            }, timeout)
        });
    }


    static getWeb3Nonce(web3, address, option, callback) {
        return new Promise((resolve, reject) => {
            web3.eth.getTransactionCount(address, option || 'pending')
                .then(nonce => {
                    nonce = web3.utils.toHex(nonce);

                    callback && callback(nonce);

                    resolve(nonce);
                })
                .catch((e) => {
                    console.error('getWeb3Nonce error');
                    console.log(e);
                    reject(e);
                });
        })
    }
}

module.exports = Txsender;
