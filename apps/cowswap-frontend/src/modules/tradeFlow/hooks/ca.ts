import { useWriteContract, useUnifiedBalance } from "@arcana/ca-wagmi";
import { Currency, CurrencyAmount } from "@uniswap/sdk-core";
import { erc20Abi } from "viem";
import { UserAsset } from "@arcana/ca-wagmi/node_modules/@arcana/ca-sdk/dist/types/typings"; // Ensure this import is correct

export function transfer (account: string, inputAmount: CurrencyAmount<Currency>): void {
    const { writeContract } = useWriteContract()
    writeContract(
      {
        address: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
        abi: erc20Abi,
        functionName: "transfer",
        args: [`0x${account}`, BigInt(inputAmount.toExact())],
      },
      {
        onSuccess(hash) {
          console.log("success");
        },
        onError(error) {
          console.log({ error });
        },
      }
    );
}

let unifiedBalance: UserAsset[] | null = null;

export const getCABalance = () => {
  unifiedBalance  = unifiedBalance == null ? useUnifiedBalance().balances : unifiedBalance
  return unifiedBalance
}