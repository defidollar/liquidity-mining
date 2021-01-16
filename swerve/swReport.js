const fs = require('fs')
const assert = require('assert').strict;

const StakeLPToken = require('../abis/StakeLPToken.json')
const DUSD = require('../abis/DUSD.json')

const Web3 = require('web3')
const web3 = new Web3(process.env.WEB3)

const fromWei = web3.utils.fromWei
const toWei = web3.utils.toWei
const toBN = web3.utils.toBN

const fromBlock = 10800048
const toBlock = 10845365

let lastUpdateTime = fromBlock
let rewardPerTokenStored = toBN(0)
const userRewardPerTokenPaid = {}
const rewards = {}
const balanceOf = {}
let totalSupply = toBN(0)

const REWARD = toBN(toWei('2504'))
const REWARD_RATE = REWARD.div(toBN(toBlock - fromBlock))

const swDUSDAddress = '0x72a0c7ce0d5a09dd77d0bb972ddab2c3aa865b24'
const StakeLPTokenAddress = '0x3A0d2277591D8ee9e822952DB5019cD7B212D541'

async function execute() {
    const dusd = new web3.eth.Contract(DUSD, swDUSDAddress)
    let events = await dusd.getPastEvents('Transfer', { fromBlock, toBlock })

    const stakeLPToken = new web3.eth.Contract(StakeLPToken, StakeLPTokenAddress)
    events = events
        .concat(await stakeLPToken.getPastEvents('RewardPaid', { fromBlock, toBlock }))
        .sort((a, b) => a.blockNumber - b.blockNumber)
    for (let i = 0; i < events.length; i++) {
        updateGlobalReward(events[i].blockNumber)
        await processEvent(events[i])
    }

    updateGlobalReward(toBlock)
    const final = {}
    let total = toBN(0)
    Object.keys(rewards).sort().forEach(u => {
        console.log(u)
        updateReward(u)
        total = total.add(rewards[u])
        final[u] = fromWei(rewards[u].toString())
        if (final[u] == '0') delete final[u]
    })
    console.log(total.toString())
    assert.ok(total.lte(REWARD))
    fs.writeFileSync(
        `${process.cwd()}/reports/swerve/week_1_block_${fromBlock}-${toBlock}.json`,
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
                .mul(REWARD_RATE)
                .mul(toBN(1e18))
                .div(totalSupply)
        )
    lastUpdateTime = now
}

async function processEvent(event) {
    // RewardPaid is equivalent to minting
    if (event.event == 'RewardPaid') {
        event.returnValues = {
            from: '0x0000000000000000000000000000000000000000',
            to: event.returnValues.user,
            value: event.returnValues.reward
        }
    }
    let { from, to, value } = event.returnValues
    // ignore staked events
    if (to == StakeLPTokenAddress) {
        return
    }
    if (from == StakeLPTokenAddress) {
        if (to == '0x0000000000000000000000000000000000000000') { // equivalent to user burning their tokens
            // user who made the tx
            from = (await web3.eth.getTransaction(event.transactionHash)).from
        } else {
            return
        }
    }
    value = toBN(value)
    if (from != '0x0000000000000000000000000000000000000000') {
        debit(from, value)
    }
    if (to != '0x0000000000000000000000000000000000000000') {
        credit(to, value)
    }
}

function debit(account, value) {
    updateReward(account)
    if (balanceOf[account].lt(value)) {
        throw new Error('woops')
    }
    balanceOf[account] = balanceOf[account].sub(value)
    totalSupply = totalSupply.sub(value)
}

function credit(account, value) {
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

execute()
