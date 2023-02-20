# ORBIT BRIDGE

## Table of Contents

* [Overview](#overview)
* [Requirements](#requirements)
* [Installation](#installation)
* [Run](#run)
* [Parser APIs](#parser-apis)
* [Syncer APIs](#syncer-apis)

<br/>

## Overview

Orbit Bridge is a service that allows people to transfer tokens from a chain to other various chains and this project allows anyone to act as a bridge in the token transfer process.

**project modules**

Parser : Gathers block info and filters Orbit Bridge's transactions out of it from various chains.

Syncer : Saves the filtered info and provides data for the Operator to send transactions to various chains.

Operator : Executes transactions to various chains.

Validator : Checks if the transfer requests sent from various chains are valid.

<br/>


## Requirements

* Docker, [docker-compose](https://docs.docker.com/compose/install/)
* Orbit chain contracts (multisig message wallets)
* Vault contract or wallet of the origin chain
* Minter contracts (destination chain)
* Governance registered in Orbit chain
* Origin / Destination / Orbit node endpoints (running your own node might be needed in addition)


<br/>

## DETAILED GUIDE HERE

* [FOR VALIDATOR](https://orbit-1.gitbook.io/orbit-bridge/validator-guide)

## Installation

* Place your governance info in *[ VAULT_DIR ]/settings.js*

## Run

* for ether vault validator
```bash
cp settings.js ~/bridge-dockerize/eth/
sudo docker-compose -f ~/bridge-dockerize/ethvault-validatot/docker-compose.yml up --build -d
```
* for ether vault operator
```bash
cp settings.js ~/bridge-dockerize/ethvault-operator/
sudo docker-compose -f ~/bridge-dockerize/ethvault-validatot/docker-compose.yml up --build -d
```

## Validator APIs

	GET|POST /
> Returns the brief status of instance.

	GET|POST /v1/gov/confirm/:address/:transactionId
> Returns the transaction hash that has been sent by validator.

<br/>


<br/>

## Parser APIs
	GET /v1/{chainName}/fullBlock/{blockNum}
    e.g. /v1/ozys/fullblock/1234567
>  Returns the entire block info of the block with the matching block number.

<br/>

	GET /v1/{chainName}/scanBlock/{blockNum}
    e.g. /v1/terra/scanBlock/1234567
>  Returns the parsed block info which only contains transactions from/to Orbit Bridge of of the block with the matching block number.
>  Note that this API only exists in specific chains.

<br/>

	GET /v1/{chainName}/tx/{hash}
    e.g. /v1/ozys/tx/0xb91c7b18851ca37fec6a4aabb6b9595ae5f84a7cf0966321144f48fe6c197617
> Returns the transaction info of the transaction with the matching transaction hash.

<br>


## Syncer APIs
	GET /v1/{chainName}/lock-relay
> Returns the list of transactions that needs to be validated by the Orbit Hub.

<br/>

	GET /v1/{chainName}/pending-release
> Returns the list of transactions that has been validated by the Orbit Hub and is waiting to be executed.

<br/>
