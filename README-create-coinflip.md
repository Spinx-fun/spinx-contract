# Spinx Coinflip Creation Script

This script allows you to create a coinflip on the Spinx contract based on the test file structure.

## Prerequisites

1. **Node.js and npm/yarn** installed
2. **Solana CLI** installed and configured
3. **Anchor framework** installed
4. **SPINX tokens** in your wallet
5. **SOL** for transaction fees

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```

2. **Create a `.env` file** with your configuration:
   ```env
   RPC_URL=https://api.devnet.solana.com
   CREATOR_PRIVATE_KEY=your_base58_private_key_here
   ```

3. **Get your private key:**
   ```bash
   solana-keygen new --outfile ~/my-keypair.json
   solana-keygen pubkey ~/my-keypair.json
   # Copy the private key array to CREATOR_PRIVATE_KEY in .env
   ```

4. **Get SPINX tokens:**
   - The script uses the SPINX token: `EY4wsByMUEudm4FRC2nTFfmiWFCMdhJx5j69ZTfQ8mz6`
   - You need to have this token in your wallet
   - The default amount is 10 tokens (10,000,000,000 units with 9 decimals)

## Usage

### Run the script:
```bash
npx ts-node create-coinflip.ts
```

### Or using npm script:
```bash
npm run create-coinflip
```

## Configuration

You can modify these constants in the script:

```typescript
// Coinflip parameters
const COINFLIP_AMOUNT = new BN(10_000_000_000); // 10 tokens
const SET_NUMBER = 1; // 1 for heads, 0 for tails
```

## What the script does:

1. **Connects** to the Solana network (devnet by default)
2. **Loads** your wallet from the private key
3. **Fetches** the current global data to get the next pool ID
4. **Calculates** the coinflip pool PDA
5. **Checks** your token balance
6. **Creates** the coinflip transaction
7. **Displays** the results and transaction signature

## Output Example:

```
🚀 Starting coinflip creation...
📡 Connected to: https://api.devnet.solana.com
👤 Using creator wallet from .env: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
🌐 Global Data PDA: 8xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
🎯 Next Pool ID: 1
🎲 Coinflip Pool PDA: 9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
🪙 SPINX Token: EY4wsByMUEudm4FRC2nTFfmiWFCMdhJx5j69ZTfQ8mz6
💰 Creator token balance: 100 tokens
🏦 SPL Escrow: 1xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
💎 Creator SOL balance: 2.5 SOL
🎯 Creating coinflip with:
   - Amount: 10000000000 tokens
   - Set Number: 1 (1=heads, 0=tails)
   - Pool ID: 1
✅ Coinflip created successfully!
📝 Transaction signature: 5J7Xtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...
🔗 View on Solana Explorer: https://explorer.solana.com/tx/5J7Xtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...?cluster=devnet

📊 Coinflip Details:
   - Pool ID: 1
   - Creator: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   - Amount: 10000000000
   - Set Number: 1
   - Status: Waiting
   - Pool Amount: 10000000000
🔄 Next Pool ID is now: 2
🎉 Script completed
```

## Troubleshooting

### Common Issues:

1. **"Insufficient token balance"**
   - Make sure you have enough SPINX tokens
   - Check the token address is correct

2. **"Insufficient funds for rent"**
   - Make sure you have enough SOL for transaction fees

3. **"Program not found"**
   - Make sure the Spinx program is deployed
   - Check the program ID in the IDL

4. **"Account not found"**
   - Make sure the global data account is initialized
   - Run the initialization first if needed

### Getting Help:

- Check the transaction signature on Solana Explorer
- Verify your wallet has the required tokens
- Ensure you're connected to the correct network (devnet/mainnet)

## Security Notes:

- Never share your private key
- Test on devnet first
- Verify transaction details before signing
- Keep your private key secure
