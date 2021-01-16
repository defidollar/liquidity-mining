const fs = require('fs')
const assert = require('assert').strict;

const IERC20 = require('../abis/DUSD.json')

const Web3 = require('web3')
const web3 = new Web3(process.env.INFURA)

const fromWei = web3.utils.fromWei
const toWei = web3.utils.toWei
const toBN = web3.utils.toBN

const genesis = 10867372

const fromBlock = 11094087
const toBlock = 11139980

let rewardPerTokenStored = toBN(0)
const userRewardPerTokenPaid = {}
const rewards = {}
const balanceOf = {}
let lastUpdateTime = fromBlock
let totalSupply = toBN(0)

const REWARD = toBN(toWei('13558.4'))
const REWARD_RATE = REWARD.div(toBN(toBlock - fromBlock))

async function execute() {
    const bpt = new web3.eth.Contract(IERC20, '0xed5ad5f258eef6a9745042bde7d46e8a5254c183')
    let events = await bpt.getPastEvents('Transfer', { fromBlock: genesis, toBlock })
    events = events.sort((a, b) => a.blockNumber - b.blockNumber)
    for (let i = 0; i < events.length; i++) {
        if (events[i].blockNumber > fromBlock) { // rewards start fromBlock
            updateGlobalReward(events[i].blockNumber)
        }
        await processEvent(events[i])
    }

    updateGlobalReward(toBlock)
    const final = {}
    let total = toBN(0)
    Object.keys(rewards).forEach(updateReward)
    Object.keys(rewards)
        .sort()
        // .sort((a, b) => parseInt(fromWei(rewards[a])) - parseInt(fromWei(rewards[b])))
        .forEach(u => {
            total = total.add(rewards[u])
            final[u] = fromWei(rewards[u])
            if (final[u] == '0') delete final[u]
        })
    console.log(total.toString())
    assert.ok(total.lte(REWARD))
    fs.writeFileSync(
        `${process.cwd()}/reports/week_9_block_${fromBlock}-${toBlock}.json`,
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
    let { from, to, value } = event.returnValues
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
        // console.log(balanceOf[account].toString(), value.toString())
        throw new Error(`woops`)
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
