import { useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'

import { LpToken, NATIVE_CURRENCIES } from '@cowprotocol/common-const'
import type { SupportedChainId } from '@cowprotocol/cow-sdk'
import { useAllActiveTokens } from '@cowprotocol/tokens'

import ms from 'ms.macro'

import { BalancesCacheUpdater } from './BalancesCacheUpdater'

import { useNativeTokenBalance } from '../hooks/useNativeTokenBalance'
import { usePersistBalancesAndAllowances } from '../hooks/usePersistBalancesAndAllowances'
import { balancesAtom } from '../state/balancesAtom'

// A small gap between balances and allowances refresh intervals is needed to avoid high load to the node at the same time
const BALANCES_SWR_CONFIG = { refreshInterval: ms`31s` }
const ALLOWANCES_SWR_CONFIG = { refreshInterval: ms`33s` }

export interface BalancesAndAllowancesUpdaterProps {
  account: string | undefined
  chainId: SupportedChainId
}
export function BalancesAndAllowancesUpdater({ account, chainId }: BalancesAndAllowancesUpdaterProps) {
  const setBalances = useSetAtom(balancesAtom)

  const allTokens = useAllActiveTokens()
  const { data: nativeTokenBalance } = useNativeTokenBalance(account)

  const tokenAddresses = useMemo(
    () => allTokens.filter((token) => !(token instanceof LpToken)).map((token) => token.address),
    [allTokens],
  )

  usePersistBalancesAndAllowances({
    account,
    chainId,
    tokenAddresses,
    setLoadingState: true,
    balancesSwrConfig: BALANCES_SWR_CONFIG,
    allowancesSwrConfig: ALLOWANCES_SWR_CONFIG,
  })

  // Add native token balance to the store as well
  useEffect(() => {
    const nativeToken = NATIVE_CURRENCIES[chainId]
    const nativeBalanceState = nativeTokenBalance ? { [nativeToken.address.toLowerCase()]: nativeTokenBalance } : {}

    setBalances((state) => ({ ...state, values: { ...state.values, ...nativeBalanceState } }))
  }, [nativeTokenBalance, chainId, setBalances])

  return account ? <BalancesCacheUpdater chainId={chainId} /> : null
}
