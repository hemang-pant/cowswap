import * as styledEl from './styled'
import { TradeWidgetForm } from './TradeWidgetForm'
import { TradeWidgetModals } from './TradeWidgetModals'
import { TradeWidgetUpdaters } from './TradeWidgetUpdaters'
import { TradeWidgetProps } from './types'

export const TradeWidgetContainer = styledEl.Container

export function TradeWidget(props: TradeWidgetProps) {
  const { id, slots, params, confirmModal, genericModal } = props
  const {
    disableQuotePolling = false,
    disableNativeSelling = false,
    tradeQuoteStateOverride,
    enableSmartSlippage,
  } = params
  const modals = TradeWidgetModals({ confirmModal, genericModal, selectTokenWidget: slots.selectTokenWidget })

  return (
    <>
      <styledEl.Container id={id}>
        <TradeWidgetUpdaters
          disableQuotePolling={disableQuotePolling}
          disableNativeSelling={disableNativeSelling}
          tradeQuoteStateOverride={tradeQuoteStateOverride}
          enableSmartSlippage={enableSmartSlippage}
          onChangeRecipient={props.actions.onChangeRecipient}
        >
          {slots.updaters}
        </TradeWidgetUpdaters>

        <styledEl.Container>{modals || <TradeWidgetForm {...props} slots={slots} />}</styledEl.Container>
      </styledEl.Container>
    </>
  )
}
