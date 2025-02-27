import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'

import { useTokensBalances } from '@cowprotocol/balances-and-allowances'
import { NATIVE_CURRENCY_ADDRESS, WRAPPED_NATIVE_CURRENCIES } from '@cowprotocol/common-const'
import { useIsWindowVisible } from '@cowprotocol/common-hooks'
import { getPromiseFulfilledValue, isSellOrder } from '@cowprotocol/common-utils'
import { PriceQuality, SupportedChainId as ChainId } from '@cowprotocol/cow-sdk'
import { UiOrderType } from '@cowprotocol/types'
import { useWalletInfo } from '@cowprotocol/wallet'
import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'

import { FeeInformation } from 'types'

import { useGetGpPriceStrategy } from 'legacy/hooks/useGetGpPriceStrategy'
import { PriceStrategy } from 'legacy/state/gas/atoms'
import { Order } from 'legacy/state/orders/actions'
import { PENDING_ORDERS_PRICE_CHECK_POLL_INTERVAL } from 'legacy/state/orders/consts'
import { useOnlyPendingOrders, useSetIsOrderUnfillable } from 'legacy/state/orders/hooks'
import {
  getEstimatedExecutionPrice,
  getOrderMarketPrice,
  getRemainderAmount,
  isOrderUnfillable
} from 'legacy/state/orders/utils'
import type { LegacyFeeQuoteParams } from 'legacy/state/price/types'
import { getBestQuote } from 'legacy/utils/price'

import { priceOutOfRangeAnalytics } from 'modules/analytics'
import { updatePendingOrderPricesAtom } from 'modules/orders/state/pendingOrdersPricesAtom'

import { getUiOrderType } from 'utils/orderUtils/getUiOrderType'

import { PRICE_QUOTE_VALID_TO_TIME } from '../../constants/quote'

/**
 * Updater that checks whether pending orders are still "fillable"
 */
export function UnfillableOrdersUpdater(): null {
  const { chainId, account } = useWalletInfo()
  const updatePendingOrderPrices = useSetAtom(updatePendingOrderPricesAtom)
  const isWindowVisible = useIsWindowVisible()

  const pending = useOnlyPendingOrders(chainId)

  const setIsOrderUnfillable = useSetIsOrderUnfillable()
  const strategy = useGetGpPriceStrategy()

  const { values: balances } = useTokensBalances()

  // Ref, so we don't rerun useEffect
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const isUpdating = useRef(false) // TODO: Implement using SWR or retry/cancellable promises

  const updateOrderMarketPriceCallback = useCallback(
    (
      order: Order,
      fee: FeeInformation | null,
      marketPrice: Price<Currency, Currency>,
      estimatedExecutionPrice: Price<Currency, Currency> | null,
    ) => {
      if (!fee?.amount) return

      updatePendingOrderPrices({
        orderId: order.id,
        data: {
          lastUpdateTimestamp: Date.now(),
          marketPrice,
          estimatedExecutionPrice,
          feeAmount: CurrencyAmount.fromRawAmount(marketPrice.baseCurrency, fee.amount),
        },
      })
    },
    [updatePendingOrderPrices],
  )

  const updateIsUnfillableFlag = useCallback(
    (chainId: ChainId, order: Order, priceAmount: string, fee: FeeInformation | null) => {
      if (!fee?.amount) return

      const orderPrice = new Price(
        order.inputToken,
        order.outputToken,
        order.sellAmount.toString(),
        order.buyAmount.toString(),
      )

      const marketPrice = getOrderMarketPrice(order, priceAmount, fee.amount)
      const estimatedExecutionPrice = getEstimatedExecutionPrice(order, marketPrice, fee.amount)

      const isSwap = getUiOrderType(order) === UiOrderType.SWAP
      const isUnfillable = isSwap && isOrderUnfillable(order, orderPrice, marketPrice)

      // Only trigger state update if flag changed
      if (order.isUnfillable !== isUnfillable && isSwap) {
        setIsOrderUnfillable({ chainId, id: order.id, isUnfillable })

        // order.isUnfillable by default is undefined, so we don't want to dispatch this in that case
        if (typeof order.isUnfillable !== 'undefined') {
          const label = `${order.inputToken.symbol}, ${order.outputToken.symbol}`
          priceOutOfRangeAnalytics(isUnfillable, label)
        }
      }

      updateOrderMarketPriceCallback(order, fee, marketPrice, estimatedExecutionPrice)
    },
    [setIsOrderUnfillable, updateOrderMarketPriceCallback],
  )

  const balancesRef = useRef(balances)
  balancesRef.current = balances
  const updatePending = useCallback(() => {
    if (!chainId || !account || isUpdating.current || !isWindowVisible) {
      return
    }

    try {
      isUpdating.current = true

      const lowerCaseAccount = account.toLowerCase()
      // Only check pending orders of the connected account
      const pending = pendingRef.current.filter((order) => order.owner.toLowerCase() === lowerCaseAccount)

      if (pending.length === 0) {
        return
      }

      pending.forEach((order) => {
        _getOrderPrice(chainId, order, strategy)
          .then((quote) => {
            if (quote) {
              const [promisedPrice, promisedFee] = quote
              const price = getPromiseFulfilledValue(promisedPrice, null)
              const fee = getPromiseFulfilledValue(promisedFee, null)

              price?.amount &&
                fee &&
                updateIsUnfillableFlag(chainId, order, price.amount, {
                  expirationDate: fee.expiration,
                  amount: fee.quote.feeAmount,
                })
            }
          })
          .catch((e) => {
            updatePendingOrderPrices({
              orderId: order.id,
              data: null,
            })

            console.debug(
              `[UnfillableOrdersUpdater::updateUnfillable] Failed to get quote on chain ${chainId} for order ${order?.id}`,
              e,
            )
          })
      })
    } finally {
      isUpdating.current = false
    }
  }, [account, chainId, strategy, updateIsUnfillableFlag, isWindowVisible, updatePendingOrderPrices])

  const updatePendingRef = useRef(updatePending)
  updatePendingRef.current = updatePending

  useEffect(() => {
    if (!chainId || !account || !isWindowVisible) {
      return
    }

    updatePendingRef.current()
    const interval = setInterval(() => updatePendingRef.current(), PENDING_ORDERS_PRICE_CHECK_POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [chainId, account, isWindowVisible])

  return null
}

/**
 * Thin wrapper around `getBestPrice` that builds the params and returns null on failure
 */
async function _getOrderPrice(chainId: ChainId, order: Order, strategy: PriceStrategy) {
  let baseToken, quoteToken

  // TODO: consider a fixed amount in case of partial fills
  const amount = getRemainderAmount(order.kind, order)

  // Don't quote if there's nothing left to match in this order
  if (amount === '0') return null

  if (isSellOrder(order.kind)) {
    // this order sell amount is sellAmountAfterFees
    // this is an issue as it will be adjusted again in the backend
    // e.g order submitted w/sellAmount adjusted for fee: 995, we re-query 995
    // e.g backend adjusts for fee again, 990 is used. We need to avoid double fee adjusting
    // e.g so here we need to pass the sellAmountBeforeFees
    baseToken = order.sellToken
    quoteToken = order.buyToken
  } else {
    baseToken = order.buyToken
    quoteToken = order.sellToken
  }

  const isEthFlow = order.sellToken === NATIVE_CURRENCY_ADDRESS

  const quoteParams = {
    chainId,
    amount,
    kind: order.kind,
    // we need to get wrapped token quotes (native quotes will fail)
    sellToken: isEthFlow ? WRAPPED_NATIVE_CURRENCIES[chainId].address : order.sellToken,
    buyToken: order.buyToken,
    baseToken,
    quoteToken,
    fromDecimals: order.inputToken.decimals,
    toDecimals: order.outputToken.decimals,
    userAddress: order.owner,
    receiver: order.receiver,
    isEthFlow,
    priceQuality: PriceQuality.OPTIMAL,
    appData: order.appData ?? undefined,
    appDataHash: order.appDataHash ?? undefined,
  }

  const legacyFeeQuoteParams = quoteParams as LegacyFeeQuoteParams

  legacyFeeQuoteParams.validFor = Math.round(PRICE_QUOTE_VALID_TO_TIME / 1000)

  try {
    return getBestQuote({ strategy, quoteParams, fetchFee: false, isPriceRefresh: false })
  } catch {
    return null
  }
}
