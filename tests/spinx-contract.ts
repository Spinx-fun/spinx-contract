import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Spinx } from "../target/types/spinx";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import BN from "bn.js";

describe("spinx", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Spinx as Program<Spinx>;
  const wallet = provider.wallet as anchor.Wallet;

  // Constants
  const GLOBAL_AUTHORITY_SEED = "global-authority";
  const VAULT_SEED = "vault-authority";
  const COINFLIP_SEED = "coinflip-authority";
  const SPINX_TOKEN_ADDRESS = "8Zd8FKrY2TMcRAUqPgFYXfasvkL4z8V6HA2KijHgAt1Z";
  const TREASURY_WALLET = "Hsz6954x56Ufk9BDYhXhdMMmWXu9Fwmqvd87XB9nk2Hd";
  const COINFLIP_FEE = 1000000;

  // Test accounts
  let globalData: PublicKey;
  let solVault: PublicKey;
  let spinxMint: PublicKey;
  let creatorTokenAccount: PublicKey;
  let joinerTokenAccount: PublicKey;
  let joiner: Keypair;
  
  // PDAs
  let globalDataBump: number;
  let solVaultBump: number;

  // Test data
  const coinflipAmount = new BN(1_000_000_000); // 1 token
  const setNumber = new BN(1); // 1 for heads, 0 for tails

  before(async () => {
    // Find PDAs
    const [globalDataPda, globalDataBumpVal] = await PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_AUTHORITY_SEED)],
      program.programId
    );
    globalData = globalDataPda;
    globalDataBump = globalDataBumpVal;

    const [solVaultPda, solVaultBumpVal] = await PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_SEED)],
      program.programId
    );
    solVault = solVaultPda;
    solVaultBump = solVaultBumpVal;

    // Create a new keypair for the joiner
    joiner = Keypair.generate();

    // Airdrop SOL to joiner
    const airdropSig = await provider.connection.requestAirdrop(
      joiner.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create a test token mint
    spinxMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      wallet.publicKey,
      9 // 9 decimals
    );

    // Create token accounts for creator and joiner
    creatorTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      spinxMint,
      wallet.publicKey
    );

    joinerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      spinxMint,
      joiner.publicKey
    );

    // Mint tokens to creator and joiner
    await mintTo(
      provider.connection,
      wallet.payer,
      spinxMint,
      creatorTokenAccount,
      wallet.payer,
      10 * 10**9 // 10 tokens
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      spinxMint,
      joinerTokenAccount,
      wallet.payer,
      10 * 10**9 // 10 tokens
    );
  });

  it("Initializes the program", async () => {
    // Initialize the program
    const tx = await program.methods
      .initialize()
      .accounts({
        admin: wallet.publicKey,
        globalData: globalData,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Initialize transaction signature", tx);

    // Fetch the global data account
    const globalDataAccount = await program.account.globalData.fetch(globalData);
    
    // Verify the global data was initialized correctly
    assert.equal(globalDataAccount.superAdmin.toString(), wallet.publicKey.toString());
    assert.equal(globalDataAccount.treasuryWallet.toString(), TREASURY_WALLET);
    assert.equal(globalDataAccount.spinxToken.toString(), SPINX_TOKEN_ADDRESS);
    assert.equal(globalDataAccount.coinflipFee.toString(), COINFLIP_FEE.toString());
    assert.equal(globalDataAccount.nextPoolId.toString(), "1", "Next pool ID should be initialized to 1");
  });

  it("Creates a coinflip with pool_id = 1", async () => {
    // Get current timestamp
    const ts = new BN(Math.floor(Date.now() / 1000));
    
    // Find the coinflip PDA
    const [coinflipPool] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from(COINFLIP_SEED),
        wallet.publicKey.toBuffer(),
        ts.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Find the SPL escrow account
    const splEscrow = await getAssociatedTokenAddress(
      spinxMint,
      coinflipPool,
      true
    );

    // Create the coinflip
    const tx = await program.methods
      .createCoinflip(ts, setNumber, coinflipAmount)
      .accounts({
        creator: wallet.publicKey,
        globalData: globalData,
        creatorTokenAccount: creatorTokenAccount,
        spinxMint: spinxMint,
        coinflipPool: coinflipPool,
        solVault: solVault,
        tokenAccount: creatorTokenAccount,
        splEscrow: splEscrow,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Create coinflip transaction signature", tx);

    // Fetch the coinflip pool account
    const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);
    
    // Verify the coinflip pool was created correctly
    assert.equal(coinflipPoolAccount.startTs.toString(), ts.toString());
    assert.equal(coinflipPoolAccount.creatorPlayer.toString(), wallet.publicKey.toString());
    assert.equal(coinflipPoolAccount.creatorAmount.toString(), coinflipAmount.toString());
    assert.equal(coinflipPoolAccount.creatorSetNumber.toString(), setNumber.toString());
    assert.equal(coinflipPoolAccount.poolAmount.toString(), coinflipAmount.toString());
    assert.equal(coinflipPoolAccount.poolId.toString(), "1", "First coinflip should have pool_id = 1");

    // Verify the global data was updated correctly
    const globalDataAccount = await program.account.globalData.fetch(globalData);
    assert.equal(globalDataAccount.nextPoolId.toString(), "2", "Next pool ID should be incremented to 2");
  });

  it("Creates a second coinflip with pool_id = 2", async () => {
    // Get current timestamp + 1 to ensure a different PDA
    const ts = new BN(Math.floor(Date.now() / 1000) + 1);
    
    // Find the coinflip PDA
    const [coinflipPool] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from(COINFLIP_SEED),
        wallet.publicKey.toBuffer(),
        ts.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Find the SPL escrow account
    const splEscrow = await getAssociatedTokenAddress(
      spinxMint,
      coinflipPool,
      true
    );

    // Create the coinflip
    const tx = await program.methods
      .createCoinflip(ts, setNumber, coinflipAmount)
      .accounts({
        creator: wallet.publicKey,
        globalData: globalData,
        creatorTokenAccount: creatorTokenAccount,
        spinxMint: spinxMint,
        coinflipPool: coinflipPool,
        solVault: solVault,
        tokenAccount: creatorTokenAccount,
        splEscrow: splEscrow,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Create second coinflip transaction signature", tx);

    // Fetch the coinflip pool account
    const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);
    
    // Verify the coinflip pool was created correctly with pool_id = 2
    assert.equal(coinflipPoolAccount.poolId.toString(), "2", "Second coinflip should have pool_id = 2");

    // Verify the global data was updated correctly
    const globalDataAccount = await program.account.globalData.fetch(globalData);
    assert.equal(globalDataAccount.nextPoolId.toString(), "3", "Next pool ID should be incremented to 3");
  });

  it("Allows a joiner to join a coinflip", async () => {
    // Get the timestamp from the first coinflip
    const ts = new BN(Math.floor(Date.now() / 1000));
    
    // Find the coinflip PDA
    const [coinflipPool] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from(COINFLIP_SEED),
        wallet.publicKey.toBuffer(),
        ts.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Find the SPL escrow account
    const splEscrow = await getAssociatedTokenAddress(
      spinxMint,
      coinflipPool,
      true
    );

    // Create a new coinflip for joining
    await program.methods
      .createCoinflip(ts, setNumber, coinflipAmount)
      .accounts({
        creator: wallet.publicKey,
        globalData: globalData,
        creatorTokenAccount: creatorTokenAccount,
        spinxMint: spinxMint,
        coinflipPool: coinflipPool,
        solVault: solVault,
        tokenAccount: creatorTokenAccount,
        splEscrow: splEscrow,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Join the coinflip with a different set number
    const joinerSetNumber = new BN(0); // Opposite of creator's choice
    
    try {
      const tx = await program.methods
        .joinCoinflip(joinerSetNumber, coinflipAmount)
        .accounts({
          joiner: joiner.publicKey,
          globalData: globalData,
          joinerTokenAccount: joinerTokenAccount,
          spinxMint: spinxMint,
          coinflipPool: coinflipPool,
          creatorAta: creatorTokenAccount,
          solVault: solVault,
          tokenAccount: joinerTokenAccount,
          splEscrow: splEscrow,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([joiner])
        .rpc();

      console.log("Join coinflip transaction signature", tx);

      // Fetch the coinflip pool account
      const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);
      
      // Verify the joiner was added correctly
      assert.equal(coinflipPoolAccount.joinerPlayer.toString(), joiner.publicKey.toString());
      assert.equal(coinflipPoolAccount.joinerAmount.toString(), coinflipAmount.toString());
      assert.equal(coinflipPoolAccount.joinerSetNumber.toString(), joinerSetNumber.toString());
      
      // Verify the winner was determined
      assert.notEqual(coinflipPoolAccount.winner.toString(), PublicKey.default.toString(), "Winner should be set");
      
      console.log("Winner:", coinflipPoolAccount.winner.toString());
      console.log("Creator:", coinflipPoolAccount.creatorPlayer.toString());
      console.log("Joiner:", coinflipPoolAccount.joinerPlayer.toString());
    } catch (error) {
      console.error("Error joining coinflip:", error);
      throw error;
    }
  });

  it("Sets a new fee", async () => {
    const newFee = new BN(2000000); // 2 SOL
    const newTreasuryWallet = wallet.publicKey; // Using the wallet as the new treasury for testing

    const tx = await program.methods
      .setFee(newFee, newTreasuryWallet)
      .accounts({
        admin: wallet.publicKey,
        globalData: globalData,
      })
      .rpc();

    console.log("Set fee transaction signature", tx);

    // Fetch the global data account
    const globalDataAccount = await program.account.globalData.fetch(globalData);
    
    // Verify the fee was updated correctly
    assert.equal(globalDataAccount.coinflipFee.toString(), newFee.toString());
    assert.equal(globalDataAccount.treasuryWallet.toString(), newTreasuryWallet.toString());
  });
});