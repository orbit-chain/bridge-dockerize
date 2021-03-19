# ORBIT BRIDGE

## Table of Contents

* [Overview](#overview)
* [Requirements](#requirements)
* [Installation](#installation)
* [Run](#run)

<br/>

## Overview

Orbit Bridge is a service that allows people to transfer tokens from a chain to other various chains and this project allows anyone to act as a bridge in the token transfer process.

**project modules**

Validator : Checks if the transfer requests sent from various chains are valid.

Parser : Gathers block info and filters Orbit Bridge's transactions out of it from various chains.

Syncer : Saves the filtered info and provides data for the Operator to send transactions to various chains.

Operator : Executes transactions to various chains.

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
cp settings.js ~/bridge-dockerize/ethvault-validator/
sudo docker-compose -f ~/bridge-dockerize/ethvault-validatot/docker-compose.yml up --build -d
```

## Validator APIs

	GET|POST /
> Returns the brief status of instance.

	GET|POST /v1/gov/confirm/:address/:transactionId
> Returns the transaction hash that has been sent by validator.

<br/>