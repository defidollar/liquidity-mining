const fs = require('fs')
const Web3 = require('web3')
const assert = require('assert').strict

const DUSD = require('../abis/DUSD.json')
const web3 = new Web3(process.env.INFURA)
const { fromWei, toWei, toBN } = web3.utils

const fromBlock = 11158542 // ILMO started
const ilmoStakeContract = '0xF068236eCAd5FAbb9883bbb26A6445d6C7c9A924'
const userRewardPerTokenPaid = {}
const rewards = {}
const balanceOf = {}

let reward, rewardRate
let rewardPerTokenStored = toBN(0)
let totalSupply = toBN(0)

// Script based on the synthetix rewards contract
async function execute(week, startBlock, toBlock, _reward) {
    lastUpdateTime = startBlock
    reward = toBN(toWei(_reward))
    rewardRate = reward.div(toBN(toBlock - startBlock))

    // # of DUSD contributed in ILMO == # of bpt received
    const dusd = new web3.eth.Contract(DUSD, '0x5BC25f649fc4e26069dDF4cF4010F9f706c23831')
    let events = (await dusd.getPastEvents('Transfer', { filter: { to: ilmoStakeContract }, fromBlock, toBlock: 11184767 }))
        .sort((a, b) => a.blockNumber - b.blockNumber)

    for (let i = 0; i < events.length; i++) {
        credit(events[i].returnValues.from, events[i])
    }

    events = await getPastEvents()
    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        if (event.blockNumber > startBlock) {
            updateGlobalReward(event.blockNumber)
        }
        if (event.returnValues.from == ilmoStakeContract) {
            debit(event.returnValues.to, event)
        } else if (event.returnValues.to == ilmoStakeContract) {
            // 7.1M BPT were transferred from ILMO pool to staking contract - needs to be ignored
            if (event.returnValues.from != '0xD8E9690eFf99E21a2de25E0b148ffaf47F47C972') { // ILMO pool
                credit(event.returnValues.from, event)
            }
        }
    }

    // Finally update the reward at the end of period
    updateGlobalReward(toBlock)

    Object.keys(rewards)
        .forEach(account => {
            updateReward(account) // updates rewards[account]
            rewards[account] = parseFloat(fromWei(rewards[account]))
        })

    const final = {}
    let total = 0
    Object.keys(rewards)
        // .sort()
        .sort((a, b) => rewards[a] - rewards[b])
        .forEach(account => {
            if (rewards[account] > 0) {
                final[account] = rewards[account]
                total += final[account]
            }
        })

    console.log(final, total)
    // assert.ok(total <= parseFloat(fromWei(reward)))
    fs.writeFileSync(
        `${process.cwd()}/week_${week}_${startBlock}-${toBlock}.json`,
        JSON.stringify(final, null, 2)
    )
}

function updateGlobalReward(now) {
    if (totalSupply.eq(toBN(0))) {
        return
    }
    rewardPerTokenStored = rewardPerTokenStored
        .add(
            toBN(now - lastUpdateTime)
                .mul(rewardRate)
                .mul(toBN(1e18))
                .div(totalSupply)
        )
    lastUpdateTime = now
}

async function getPastEvents(fromBlock, toBlock) {
    // Transfers to and from ILMO contracts, constitutes as (un)staking
    const bpt = new web3.eth.Contract(DUSD, '0xd8e9690eff99e21a2de25e0b148ffaf47f47c972')

    // to work around "Error: Returned error: query returned more than 10000 results"
    let events = []
    let start = parseInt(fromBlock), end = parseInt(toBlock)
    while (start >= end) {
        // const mid = parseInt((start + end) / 2)
        const mid = Math.min(start + 100, end)
        events = events.concat(await bpt.getPastEvents('Transfer', { fromBlock: start, toBlock: mid }))
        start = mid + 1
    }
    return events.sort((a, b) => a.blockNumber - b.blockNumber)
}

function debit(account, event) {
    value = toBN(event.returnValues.value)
    updateReward(account)
    if (balanceOf[account].lt(value)) {
        console.log(account, balanceOf[account].toString(), value.toString())
        throw new Error('woops')
    }
    balanceOf[account] = balanceOf[account].sub(value)
    totalSupply = totalSupply.sub(value)
}

function credit(account, event) {
    value = toBN(event.returnValues.value)
    updateReward(account)
    balanceOf[account] = balanceOf[account].add(value)
    totalSupply = totalSupply.add(value)
}

function updateReward(account) {
    initializeAccount(account)
    rewards[account] = balanceOf[account]
        .mul(rewardPerTokenStored.sub(userRewardPerTokenPaid[account]))
        .div(toBN(1e18))
        .add(rewards[account])
    userRewardPerTokenPaid[account] = rewardPerTokenStored
}

function initializeAccount(account) {
    if (userRewardPerTokenPaid[account] == null) {
        userRewardPerTokenPaid[account] = toBN(0)
    }
    if (rewards[account] == null) {
        rewards[account] = toBN(0)
    }
    if (balanceOf[account] == null) {
        balanceOf[account] = toBN(0)
    }
}

execute(...process.argv.slice(2))
