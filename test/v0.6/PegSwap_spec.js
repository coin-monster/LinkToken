require('../support/helpers.js')

contract('PegSwap', accounts => {
  let { PegSwap } = require('../../build/truffle/v0.6/PegSwap')
  let { Token677 } = require('../../build/truffle/v0.6/Token677')
  let { StandardTokenMock } = require('../../build/truffle/v0.6/StandardTokenMock')
  const Token20 = StandardTokenMock

  let swap, owner, base, wrapped, user
  const totalIssuance = 1000
  const depositAmount = 100
  const tradeAmount = 10
  const ownerBaseAmount = totalIssuance - depositAmount

  beforeEach(async () => {
    owner = accounts[0]
    user = accounts[1]
    base = await Token20.new(owner, totalIssuance, { from: owner })
    wrapped = await Token677.new(totalIssuance, { from: owner })
    swap = await PegSwap.new({ from: owner })

    await base.transfer(user, depositAmount, { from: owner })
  })

  it('has a limited public ABI', () => {
    checkPublicABI(PegSwap, [
      'addLiquidity',
      'getSwappableAmount',
      'onTokenTransfer',
      'recoverStuckTokens',
      'removeLiquidity',
      'swap',
      // Owned functions
      'acceptOwnership',
      'owner',
      'transferOwnership',
    ])
  })

  describe('#addLiquidity(address,address)', () => {
    beforeEach(async () => {
      await wrapped.approve(swap.address, depositAmount, { from: owner })
    })

    it("withdraws the amount from the owner's balance on the target token", async () => {
      let swapBalance = await wrapped.balanceOf(swap.address)
      assert.equal(0, swapBalance)
      let ownerBalance = await wrapped.balanceOf(owner)
      assert.equal(totalIssuance, ownerBalance)

      await swap.addLiquidity(depositAmount, base.address, wrapped.address, { from: owner })

      swapBalance = await wrapped.balanceOf(swap.address)
      assert.equal(depositAmount, swapBalance)
      ownerBalance = await wrapped.balanceOf(owner)
      assert.equal(totalIssuance - depositAmount, ownerBalance)
    })

    it('does not change balance amounts on source token', async () => {
      let swapBalance = await base.balanceOf(swap.address)
      assert.equal(0, swapBalance)
      let ownerBalance = await base.balanceOf(owner)
      assert.equal(ownerBaseAmount, ownerBalance.toNumber())

      await swap.addLiquidity(depositAmount, base.address, wrapped.address, { from: owner })

      assert.equal(swapBalance, (await base.balanceOf(swap.address)).toNumber())
      assert.equal(ownerBalance, (await base.balanceOf(owner)).toNumber())
    })

    it('updates the swappable amount', async () => {
      let swappable = await swap.getSwappableAmount(base.address, wrapped.address)
      assert.equal(0, swappable)

      await swap.addLiquidity(depositAmount, base.address, wrapped.address, { from: owner })

      swappable = await swap.getSwappableAmount(base.address, wrapped.address)
      assert.equal(depositAmount, swappable)
    })

    describe('before the owner has added liquidity to a pair', async () => {
      it('reverts in either direction', async () => {
        await assertActionThrows(async () => {
          await swap.addLiquidity(0, base.address, wrapped.address, { from: user })
        })
        await assertActionThrows(async () => {
          await swap.addLiquidity(0, wrapped.address, base.address, { from: user })
        })
      })
    })

    describe('after the owner has added liquidity to a pair', async () => {
      beforeEach(async () => {
        await swap.addLiquidity(depositAmount, base.address, wrapped.address, { from: owner })
      })

      it('can be called by anyone in either direction', async () => {
        await swap.addLiquidity(0, base.address, wrapped.address, { from: user }) // doesn't revert

        await swap.addLiquidity(0, wrapped.address, base.address, { from: user }) // doesn't revert
      })
    })
  })

  describe('#removeLiquidity(uint256,address,address)', () => {
    const depositAmount = 100
    const withdrawalAmount = 50
    const startingAmount = totalIssuance - depositAmount

    beforeEach(async () => {
      await wrapped.approve(swap.address, depositAmount, { from: owner })
      await swap.addLiquidity(depositAmount, base.address, wrapped.address, { from: owner })
    })

    it('reverts if called by anyone other than the owner', async () => {
      await assertActionThrows(async () => {
        await swap.removeLiquidity(withdrawalAmount, base.address, wrapped.address, {
          from: user,
        })
      })
    })

    it("withdraws the amount from the swap's balance on the target to the owner", async () => {
      let swapBalance = await wrapped.balanceOf(swap.address)
      assert.equal(depositAmount, swapBalance)
      let ownerBalance = await wrapped.balanceOf(owner)
      assert.equal(startingAmount, ownerBalance)

      await swap.removeLiquidity(withdrawalAmount, base.address, wrapped.address, {
        from: owner,
      })

      swapBalance = await wrapped.balanceOf(swap.address)
      assert.equal(depositAmount - withdrawalAmount, swapBalance)
      ownerBalance = await wrapped.balanceOf(owner)
      assert.equal(startingAmount + withdrawalAmount, ownerBalance.toNumber())
    })

    it('does not change balance amounts on source token', async () => {
      let swapBalance = await base.balanceOf(swap.address)
      assert.equal(0, swapBalance)
      let ownerBalance = await base.balanceOf(owner)
      assert.equal(ownerBaseAmount, ownerBalance.toNumber())

      await swap.removeLiquidity(withdrawalAmount, base.address, wrapped.address, {
        from: owner,
      })

      assert.equal(swapBalance, (await base.balanceOf(swap.address)).toNumber())
      assert.equal(ownerBalance, (await base.balanceOf(owner)).toNumber())
    })

    it('updates the swappable amount', async () => {
      let swappable = await swap.getSwappableAmount(base.address, wrapped.address)
      assert.equal(depositAmount, swappable)

      await swap.removeLiquidity(withdrawalAmount, base.address, wrapped.address, {
        from: owner,
      })

      swappable = await swap.getSwappableAmount(base.address, wrapped.address)
      assert.equal(depositAmount - withdrawalAmount, swappable)
    })
  })

  describe('swap(uint256,address,address)', () => {
    beforeEach(async () => {
      await wrapped.approve(swap.address, depositAmount, { from: owner })
      await swap.addLiquidity(depositAmount, base.address, wrapped.address, { from: owner })
    })

    it('reverts if enough funds have not been approved before', async () => {
      await assertActionThrows(async () => {
        await swap.swap(tradeAmount, base.address, wrapped.address, {
          from: user,
        })
      })
    })

    describe('after the user has approved the contract', () => {
      beforeEach(async () => {
        await base.approve(swap.address, depositAmount, { from: user })
      })

      it('pulls source funds from the user', async () => {
        let swapBalance = await base.balanceOf(swap.address)
        assert.equal(0, swapBalance)
        let userBalance = await base.balanceOf(user)
        assert.equal(depositAmount, userBalance)

        await swap.swap(tradeAmount, base.address, wrapped.address, {
          from: user,
        })

        swapBalance = await base.balanceOf(swap.address)
        assert.equal(tradeAmount, swapBalance)
        userBalance = await base.balanceOf(user)
        assert.equal(depositAmount - tradeAmount, userBalance.toNumber())
      })

      it('sends target funds to the user', async () => {
        let swapBalance = await wrapped.balanceOf(swap.address)
        assert.equal(depositAmount, swapBalance)
        let userBalance = await wrapped.balanceOf(user)
        assert.equal(0, userBalance)

        await swap.swap(tradeAmount, base.address, wrapped.address, {
          from: user,
        })

        swapBalance = await wrapped.balanceOf(swap.address)
        assert.equal(depositAmount - tradeAmount, swapBalance)
        userBalance = await wrapped.balanceOf(user)
        assert.equal(tradeAmount, userBalance.toNumber())
      })

      it('updates the swappable amount for the pair', async () => {
        let swappable = await swap.getSwappableAmount(base.address, wrapped.address)
        assert.equal(depositAmount, swappable.toNumber())

        await swap.swap(tradeAmount, base.address, wrapped.address, {
          from: user,
        })

        swappable = await swap.getSwappableAmount(base.address, wrapped.address)
        assert.equal(depositAmount - tradeAmount, swappable.toNumber())
      })

      it('updates the swappable amount for the inverse of the pair', async () => {
        let swappable = await swap.getSwappableAmount(wrapped.address, base.address)
        assert.equal(0, swappable.toNumber())

        await swap.swap(tradeAmount, base.address, wrapped.address, {
          from: user,
        })

        swappable = await swap.getSwappableAmount(wrapped.address, base.address)
        assert.equal(tradeAmount, swappable.toNumber())
      })

      describe('when there are not enough swappable funds available', () => {
        it('raises an error', async () => {
          const askAmount = depositAmount * 2
          await base.transfer(user, askAmount, { from: owner })
          await base.approve(swap.address, askAmount, { from: user })
          await assertActionThrows(async () => {
            await swap.swap(askAmount, base.address, wrapped.address, {
              from: user,
            })
          })
        })
      })
    })
  })

  describe('recoverStuckTokens(uint256,address)', () => {
    const dumbAmount = 420

    beforeEach(async () => {
      await base.transfer(swap.address, dumbAmount, { from: owner })
    })

    it('reverts if enough funds have not been approved before', async () => {
      await assertActionThrows(async () => {
        await swap.recoverStuckTokens(tradeAmount, base.address, {
          from: user,
        })
      })
    })

    it('moves deposits for any token', async () => {
      let swapBalance = await base.balanceOf(swap.address)
      assert.equal(dumbAmount, swapBalance.toNumber())
      let ownerBalance = await base.balanceOf(owner)
      assert.equal(ownerBaseAmount - dumbAmount, ownerBalance)

      await swap.recoverStuckTokens(dumbAmount, base.address, {
        from: owner,
      })

      swapBalance = await base.balanceOf(swap.address)
      assert.equal(0, swapBalance)
      ownerBalance = await base.balanceOf(owner)
      assert.equal(ownerBaseAmount, ownerBalance.toNumber())
    })
  })

  describe('onTokenTransfer(address,uint256,bytes)', () => {
    beforeEach(async () => {
      await wrapped.transfer(user, depositAmount, { from: owner })
      await base.approve(swap.address, depositAmount, { from: owner })
      await swap.addLiquidity(depositAmount, wrapped.address, base.address, { from: owner })
    })

    it('pulls accepts the source funds from the user', async () => {
      let swapBalance = await wrapped.balanceOf(swap.address)
      //assert.equal(depositAmount, swapBalance)
      assert.equal(0, swapBalance)
      let userBalance = await wrapped.balanceOf(user)
      assert.equal(depositAmount, userBalance)

      const data = '0x' + encodeAddress(base.address)
      await wrapped.transferAndCall(swap.address, tradeAmount, data, { from: user })

      swapBalance = await wrapped.balanceOf(swap.address)
      assert.equal(tradeAmount, swapBalance)
      userBalance = await wrapped.balanceOf(user)
      assert.equal(depositAmount - tradeAmount, userBalance.toNumber())
    })

    it('sends target funds to the user', async () => {
      let swapBalance = await base.balanceOf(swap.address)
      assert.equal(depositAmount, swapBalance)
      let userBalance = await base.balanceOf(user)
      assert.equal(depositAmount, userBalance)

      const data = '0x' + encodeAddress(base.address)
      await wrapped.transferAndCall(swap.address, tradeAmount, data, { from: user })

      swapBalance = await base.balanceOf(swap.address)
      assert.equal(depositAmount - tradeAmount, swapBalance)
      userBalance = await base.balanceOf(user)
      assert.equal(depositAmount + tradeAmount, userBalance.toNumber())
    })

    it('updates the swappable amount for the inverse of the pair', async () => {
      let swappable = await swap.getSwappableAmount(base.address, wrapped.address)
      assert.equal(0, swappable.toNumber())

      const data = '0x' + encodeAddress(base.address)
      await wrapped.transferAndCall(swap.address, tradeAmount, data, { from: user })

      swappable = await swap.getSwappableAmount(base.address, wrapped.address)
      assert.equal(tradeAmount, swappable.toNumber())
    })

    it('updates the swappable amount for the pair', async () => {
      let swappable = await swap.getSwappableAmount(wrapped.address, base.address)
      assert.equal(depositAmount, swappable.toNumber())

      const data = '0x' + encodeAddress(base.address)
      await wrapped.transferAndCall(swap.address, tradeAmount, data, { from: user })

      swappable = await swap.getSwappableAmount(wrapped.address, base.address)
      assert.equal(depositAmount - tradeAmount, swappable.toNumber())
    })
  })
})
