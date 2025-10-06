# Spinx Join Coinflip Script

This script allows you to join an existing coinflip on the Spinx contract.

## Prerequisites

1. **Node.js and npm/yarn** installed
2. **Solana CLI** installed and configured
3. **Anchor framework** installed
4. **SPINX tokens** in your wallet
5. **SOL** for transaction fees
6. **An existing coinflip** to join

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
   JOINER_PRIVATE_KEY=your_base58_private_key_here
   ```

3. **Get your private key:**
   ```bash
   solana-keygen new --outfile ~/my-keypair.json
   solana-keygen pubkey ~/my-keypair.json
   # Copy the private key array to JOINER_PRIVATE_KEY in .env
   ```

4. **Get SPINX tokens:**
   - The script uses the SPINX token: `4QAuuGj2mMjEPwsX61Sx9gwfNLcKVPotSWV3vUZfv28g`
   - You need to have this token in your wallet
   - The default amount is 10 tokens (10,000,000,000 units with 9 decimals)

## Usage

### Run the script:
```bash
npx ts-node join-coinflip.ts
```

### Or using npm script:
```bash
npm run join-coinflip
```

## Configuration

You can modify these constants in the script:

```typescript
// Join parameters
const COINFLIP_AMOUNT = new BN(10_000_000_000); // 10 tokens
const JOINER_SET_NUMBER = 0; // 0 for tails, 1 for heads
const POOL_ID = 1; // Specify which pool to join
```

## What the script does:

1. **Connects** to the Solana network (devnet by default)
2. **Loads** your joiner wallet from the private key
3. **Fetches** the specified coinflip pool
4. **Validates** the coinflip (checks if it exists, has no joiner, etc.)
5. **Checks** your token balance
6. **Sets up VRF** for randomness
7. **Joins** the coinflip transaction
8. **Displays** the results and updated coinflip details

## Output Example:

```
🎲 Starting coinflip join...
📡 Connected to: https://api.devnet.solana.com
👤 Using joiner wallet from .env: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
🌐 Global Data PDA: 8xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
🏦 Treasury Wallet: 69QQYnDRZ386bbuMV7srfgh4D5dAR51SdyZ1wWtC3CKs
🎲 Coinflip Pool PDA: 9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
📊 Existing Coinflip Details:
   - Pool ID: 1
   - Creator: 6xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   - Creator Amount: 10000000000
   - Creator Set Number: 1
   - Status: Waiting
   - Pool Amount: 10000000000
🪙 SPINX Token: 4QAuuGj2mMjEPwsX61Sx9gwfNLcKVPotSWV3vUZfv28g
💰 Joiner token balance: 100 tokens
🏦 SPL Escrow: 1xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
💎 Joiner SOL balance: 2.5 SOL
🎲 VRF Setup:
   - Force: 5xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   - Random: 3xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   - VRF Program: 4xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
🎯 Joining coinflip with:
   - Pool ID: 1
   - Amount: 10000000000 tokens
   - Set Number: 0 (0=tails, 1=heads)
✅ Successfully joined coinflip!
📝 Transaction signature: 5J7Xtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...
🔗 View on Solana Explorer: https://explorer.solana.com/tx/5J7Xtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...?cluster=devnet

📊 Updated Coinflip Details:
   - Pool ID: 1
   - Creator: 6xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   - Creator Amount: 10000000000
   - Creator Set Number: 1
   - Joiner: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
   - Joiner Amount: 10000000000
   - Joiner Set Number: 0
   - Status: Processing
   - Pool Amount: 20000000000
   - Winner: 11111111111111111111111111111111
⏳ Winner will be determined after randomness is fulfilled
🎉 Script completed
```

## Important Notes:

### Pool ID
- You must specify the correct `POOL_ID` to join
- Check existing coinflips to find available pools
- The script will validate the pool exists before attempting to join

### Set Number
- You must choose a different set number than the creator
- If creator chose 1 (heads), you must choose 0 (tails)
- If creator chose 0 (tails), you must choose 1 (heads)

### Validation Checks
The script performs several validation checks:
- ✅ Coinflip exists
- ✅ No existing joiner
- ✅ You're not the creator
- ✅ Different set number than creator
- ✅ Sufficient token balance
- ✅ Sufficient SOL balance

## Troubleshooting

### Common Issues:

1. **"This coinflip already has a joiner"**
   - The coinflip is already full
   - Try a different pool ID

2. **"You cannot join your own coinflip"**
   - You're trying to join a coinflip you created
   - Use a different wallet or different pool ID

3. **"You must choose a different set number"**
   - You chose the same set number as the creator
   - Change `JOINER_SET_NUMBER` to the opposite value

4. **"Insufficient token balance"**
   - You don't have enough SPINX tokens
   - Get more tokens or reduce the amount

5. **"Pool not found"**
   - The pool ID doesn't exist
   - Check available pools or create a new coinflip first

### Getting Help:

- Check the transaction signature on Solana Explorer
- Verify your wallet has the required tokens
- Ensure you're connected to the correct network (devnet/mainnet)
- Make sure the pool ID exists and is available

## Security Notes:

- Never share your private key
- Test on devnet first
- Verify transaction details before signing
- Keep your private key secure
- Only join coinflips you trust
