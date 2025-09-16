# Spinx Contract

A Solana smart contract for a coinflip game using Anchor framework.

## Features

- Create coinflip pools with unique pool IDs
- Join coinflip pools and determine winners
- Set fees and treasury wallet

## Development Setup

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Build the program:
   ```bash
   anchor build
   ```

3. Deploy the program:
   ```bash
   anchor deploy
   ```

## Testing

### Setting up environment variables

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file and add your private keys:
   ```
   # Wallet private keys (base58 encoded)
   CREATOR_PRIVATE_KEY=your_base58_encoded_private_key_here
   JOINER_PRIVATE_KEY=another_base58_encoded_private_key_here

   # Optional: RPC URL (defaults to localhost if not specified)
   RPC_URL=http://localhost:8899
   ```

   To get your base58 encoded private key:
   - If you're using a keypair file, you can convert it using:
     ```bash
     cat ~/.config/solana/id.json | jq -r '.[0:32] | join(",")' | tr -d '\n' | tr ',' ' ' | sed 's/ /,/g' | sed 's/,$//' | python3 -c "import base58, sys; print(base58.b58encode(bytes([int(x) for x in sys.stdin.read().split(',')])))"
     ```
   - Or generate a new keypair and save the private key:
     ```bash
     solana-keygen new --no-bip39-passphrase
     ```

3. Run the tests:
   ```bash
   yarn test
   ```

   Or run the local tests:
   ```bash
   yarn test:local
   ```

### Testing without environment variables

If you don't provide the private keys in the `.env` file:
- The creator wallet will default to the local provider wallet
- A new joiner wallet will be generated for testing

## Contract Structure

- `GlobalData`: Stores global configuration like fees, admin, and next pool ID
- `CoinflipPool`: Represents a coinflip game with creator, joiner, and game state

## Instructions

- `initialize`: Sets up the program with initial configuration
- `setFee`: Updates the fee and treasury wallet
- `createCoinflip`: Creates a new coinflip pool with an incremental pool ID
- `joinCoinflip`: Joins an existing coinflip pool and determines the winner