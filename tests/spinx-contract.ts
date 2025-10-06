import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Spinx } from "../target/types/spinx";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    Connection,
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    createAssociatedTokenAccount,
    mintTo,
    getAssociatedTokenAddress,
    getAccount,
    getMint,
} from "@solana/spl-token";
import { assert } from "chai";
import BN from "bn.js";
import * as dotenv from "dotenv";
import * as bs58 from "bs58";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { networkStateAccountAddress, Orao, randomnessAccountAddress } from "@orao-network/solana-vrf";

// Load environment variables
dotenv.config();

describe("spinx", () => {
    // Set up connection - can be configured via environment
    const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(
        RPC_URL,
        "confirmed"
    );

    // Set up creator wallet (default to provider wallet if not specified)
    let creatorKeypair: Keypair;
    if (process.env.CREATOR_PRIVATE_KEY) {
        const creatorPrivateKey = bs58.decode(process.env.CREATOR_PRIVATE_KEY);
        creatorKeypair = Keypair.fromSecretKey(Uint8Array.from(creatorPrivateKey));
        console.log("Using creator wallet from .env:", creatorKeypair.publicKey.toString());
    } else {
        // Use the default provider wallet
        const provider = anchor.AnchorProvider.env();
        creatorKeypair = (provider.wallet as anchor.Wallet).payer;
        console.log("Using default provider wallet as creator:", creatorKeypair.publicKey.toString());
    }

    // Set up joiner wallet from environment variable or generate a new one
    let joinerKeypair: Keypair;
    if (process.env.JOINER_PRIVATE_KEY) {
        const joinerPrivateKey = bs58.decode(process.env.JOINER_PRIVATE_KEY);
        joinerKeypair = Keypair.fromSecretKey(Uint8Array.from(joinerPrivateKey));
        console.log("Using joiner wallet from .env:", joinerKeypair.publicKey.toString());
    } else {
        // Generate a new keypair for testing
        joinerKeypair = Keypair.generate();
        console.log("Generated new joiner wallet for testing:", joinerKeypair.publicKey.toString());
    }

    // Create a wallet adapter for the creator
    const creatorWallet = new anchor.Wallet(creatorKeypair);

    // Create a custom provider with the creator wallet
    const provider = new anchor.AnchorProvider(
        connection,
        creatorWallet,
        { commitment: "confirmed", preflightCommitment: "confirmed" }
    );

    // Set the provider for Anchor
    anchor.setProvider(provider);

    // Get the program from IDL
    const program = anchor.workspace.Spinx as Program<Spinx>;

    // Constants
    const GLOBAL_AUTHORITY_SEED = "global-authority";
    const VAULT_SEED = "vault-authority";
    const COINFLIP_SEED = "coinflip-authority";
    const RANDOM_SEED = "random-seed";

    // Use the actual token address from the contract // Belle
    const SPINX_TOKEN_ADDRESS = "EY4wsByMUEudm4FRC2nTFfmiWFCMdhJx5j69ZTfQ8mz6";
    const TREASURY_WALLET = "EAoVpYvC3jNp1F9nym6KGXWGvyBw3PpNKWY4Dd3D8aao";
    const COINFLIP_FEE = 1000000;

    // Test accounts
    let globalData: PublicKey;
    let spinxMint: PublicKey;
    let creatorTokenAccount: PublicKey;
    let joinerTokenAccount: PublicKey;

    const vrf = new Orao(anchor.getProvider() as any);
    let force = Keypair.generate().publicKey;

    // PDAs
    let globalDataBump: number;

    // Test data
    const coinflipAmount = new BN(10_000_000_000); // 1 token (smaller amount for testing)
    const setNumber = 1; // 1 for heads, 0 for tails

    // Load the default keypair from ~/.config/solana/id.json
    let defaultKeypair: Keypair;
    
    before(async () => {
        console.log("Setting up test on Devnet...");

        try {
            const keypairPath = path.resolve(os.homedir(), ".config", "solana", "id.json");
            console.log("Loading keypair from:", keypairPath);
            const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
            defaultKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
            console.log("Loaded default keypair:", defaultKeypair.publicKey.toString());
        } catch (error) {
            console.error("Error loading default keypair:", error);
            // Fallback to using the provider's wallet
            const provider = anchor.AnchorProvider.env();
            defaultKeypair = (provider.wallet as anchor.Wallet).payer;
            console.log("Using provider wallet as fallback:", defaultKeypair.publicKey.toString());
        }
        // Find PDAs
        const [globalDataPda, globalDataBumpVal] = await PublicKey.findProgramAddressSync(
            [Buffer.from(GLOBAL_AUTHORITY_SEED)],
            program.programId
        );
        globalData = globalDataPda;
        globalDataBump = globalDataBumpVal;

        console.log("Global Data PDA:", globalData.toString());

        // Check if we need to airdrop SOL to the joiner
        if (!process.env.JOINER_PRIVATE_KEY) {
            try {
                const joinerBalance = await connection.getBalance(joinerKeypair.publicKey);
                if (joinerBalance < LAMPORTS_PER_SOL / 2) {
                    console.log("Airdropping SOL to joiner wallet...");
                    const airdropSig = await connection.requestAirdrop(
                        joinerKeypair.publicKey,
                        LAMPORTS_PER_SOL
                    );
                    await connection.confirmTransaction(airdropSig);
                    console.log("Airdropped 1 SOL to joiner wallet");
                } else {
                    console.log("Joiner wallet already has sufficient SOL:", joinerBalance / LAMPORTS_PER_SOL);
                }
            } catch (error) {
                console.error("Failed to airdrop SOL to joiner:", error);
                console.log("Continuing with test - wallet might already have SOL");
            }
        }

        // Check creator balance
        const creatorBalance = await connection.getBalance(creatorKeypair.publicKey);
        console.log("Creator wallet SOL balance:", creatorBalance / LAMPORTS_PER_SOL);

        if (creatorBalance < LAMPORTS_PER_SOL / 2) {
            console.warn("Warning: Creator wallet has low SOL balance. Tests may fail.");
        }

        // Use the existing SPINX token on Devnet
        try {
            spinxMint = new PublicKey(SPINX_TOKEN_ADDRESS);
            console.log("Using SPINX token mint:", spinxMint.toString());

            // Verify the mint exists
            await getMint(connection, spinxMint);
        } catch (error) {
            console.error("Error accessing SPINX token mint:", error);

            // Create a test token mint if the SPINX token doesn't exist
            console.log("Creating a test token mint...");
            spinxMint = await createMint(
                connection,
                creatorKeypair,
                creatorKeypair.publicKey,
                creatorKeypair.publicKey,
                9 // 9 decimals
            );
            console.log("Created test token mint:", spinxMint.toString());
        }



        // Create or get token accounts for creator and joiner
        try {
            const creatorTokenAccountAddr = await getAssociatedTokenAddress(
                spinxMint,
                creatorKeypair.publicKey
            );

            try {
                // Check if the account exists
                await getAccount(connection, creatorTokenAccountAddr);
                creatorTokenAccount = creatorTokenAccountAddr;
                console.log("Using existing creator token account:", creatorTokenAccount.toString());
            } catch (error) {
                // Create the account if it doesn't exist
                creatorTokenAccount = await createAssociatedTokenAccount(
                    connection,
                    creatorKeypair,
                    spinxMint,
                    creatorKeypair.publicKey
                );
                console.log("Created creator token account:", creatorTokenAccount.toString());
            }
        } catch (error) {
            console.error("Error with creator token account:", error);
            throw error;
        }

        try {
            const joinerTokenAccountAddr = await getAssociatedTokenAddress(
                spinxMint,
                joinerKeypair.publicKey
            );

            try {
                // Check if the account exists
                await getAccount(connection, joinerTokenAccountAddr);
                joinerTokenAccount = joinerTokenAccountAddr;
                console.log("Using existing joiner token account:", joinerTokenAccount.toString());
            } catch (error) {
                // Create the account if it doesn't exist
                joinerTokenAccount = await createAssociatedTokenAccount(
                    connection,
                    creatorKeypair,
                    spinxMint,
                    joinerKeypair.publicKey
                );
                console.log("Created joiner token account:", joinerTokenAccount.toString());
            }
        } catch (error) {
            console.error("Error with joiner token account:", error);
            throw error;
        }

        // Check token balances
        try {
            const creatorTokenInfo = await getAccount(connection, creatorTokenAccount);
            console.log("Creator token balance:", Number(creatorTokenInfo.amount) / 10 ** 9);

            const joinerTokenInfo = await getAccount(connection, joinerTokenAccount);
            console.log("Joiner token balance:", Number(joinerTokenInfo.amount) / 10 ** 9);

        } catch (error) {
            console.error("Error checking token balances:", error);
        }

        console.log("Test setup completed");
    });

    it("Initializes the program if not already initialized", async () => {
        try {
            // Check if the global data account already exists
            try {
                const globalDataAccount = await program.account.globalData.fetch(globalData);
                console.log("Program already initialized with next_pool_id:", globalDataAccount.nextPoolId.toString());
                return; // Skip initialization if already initialized
            } catch (error) {
                // Account doesn't exist, proceed with initialization
                console.log("Initializing program...");
            }

            // Get the wallet from the provider - this ensures we're using the anchor wallet
            const wallet = provider.wallet.publicKey;
            console.log("Using wallet for admin:", wallet.toString());

            // Initialize the program
            const tx = await program.methods
                .initialize()
                .accounts({
                    admin: wallet,
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
            assert.equal(globalDataAccount.superAdmin.toString(), creatorKeypair.publicKey.toString());
            assert.equal(globalDataAccount.treasuryWallet.toString(), TREASURY_WALLET);
            assert.equal(globalDataAccount.spinxToken.toString(), SPINX_TOKEN_ADDRESS);
            assert.equal(globalDataAccount.coinflipFee.toString(), COINFLIP_FEE.toString());
            assert.equal(globalDataAccount.nextPoolId.toString(), "1", "Next pool ID should be initialized to 1");
        } catch (error) {
            console.error("Error initializing program:", error);
            console.log("Continuing with test - program might already be initialized");
        }
    });

    it("Creates a coinflip with pool_id", async () => {
        const globalDataAccount = await program.account.globalData.fetch(globalData);
        // Get a new timestamp for a fresh coinflip
        const pool_id = new BN(globalDataAccount.nextPoolId.toNumber());

        // Find the coinflip PDA
        const [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                pool_id.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );

        try {
            // Get the current next_pool_id
            const globalDataBefore = await program.account.globalData.fetch(globalData);
            const expectedPoolId = globalDataBefore.nextPoolId;
            console.log("Expected pool_id for new coinflip:", expectedPoolId.toString());

            // Create the coinflip
            const tx = await program.methods
                .createCoinflip(setNumber, coinflipAmount)
                .accounts({
                    creator: creatorKeypair.publicKey,
                    globalData: globalData,
                    creatorAta: creatorTokenAccount,
                    spinxMint: spinxMint,
                    coinflipPool: coinflipPool,
                    treasuryWallet: new PublicKey(TREASURY_WALLET),
                    splEscrow: splEscrow,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .preInstructions([
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
                ])
                .rpc();

            console.log("Create coinflip transaction signature", tx);

            // Fetch the coinflip pool account
            const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);

            // Verify the coinflip pool was created correctly
            assert.equal(coinflipPoolAccount.creatorPlayer.toString(), creatorKeypair.publicKey.toString());
            assert.equal(coinflipPoolAccount.creatorAmount.toString(), coinflipAmount.toString());
            assert.equal(coinflipPoolAccount.creatorSetNumber.toString(), setNumber.toString());
            assert.equal(coinflipPoolAccount.poolAmount.toString(), coinflipAmount.toString());
            assert.equal(coinflipPoolAccount.poolId.toString(), expectedPoolId.toString(),
                `Coinflip should have pool_id = ${expectedPoolId}`);

            // Verify the global data was updated correctly
            const globalDataAfter = await program.account.globalData.fetch(globalData);
            assert.equal(globalDataAfter.nextPoolId.toString(), (expectedPoolId.toNumber() + 1).toString(),
                `Next pool ID should be incremented to ${expectedPoolId.toNumber() + 1}`);

            console.log("Coinflip created successfully with pool_id:", coinflipPoolAccount.poolId.toString());
            console.log("Next pool_id is now:", globalDataAfter.nextPoolId.toString());
        } catch (error) {
            console.error("Error creating coinflip:", error);
            throw error;
        }
    });

    it("Close the Coinflip", async () => {
        const globalDataAccount = await program.account.globalData.fetch(globalData);
        // Get a new timestamp for a fresh coinflip
        const pool_id = new BN(globalDataAccount.nextPoolId.toNumber() - 1);
        // Get a new timestamp for a fresh coinflip
        console.log("Get Result Pool ID:", pool_id.toString())

        // Find the coinflip PDA
        let [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                pool_id.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );

        console.log("CoinflipPool: ", coinflipPool.toBase58())

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );

        console.log("splEscrow: ", splEscrow.toBase58())

        try {
            const tx = await program.methods.closeCoinflip(pool_id).accounts({
                signer: creatorKeypair.publicKey,
                coinflipPool: coinflipPool,
                splEscrow: splEscrow,
                spinxMint: spinxMint,
                creatorAta: creatorTokenAccount,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            }).rpc();
    
    
            console.log(`CoinFlip {} is finished`, pool_id, tx)

        } catch (e) {
            console.log(e)
        }

    })

    it("Creates a second coinflip with incremented pool_id", async () => {
        const globalDataAccount = await program.account.globalData.fetch(globalData);
        // Get a new timestamp for a fresh coinflip
        const pool_id = new BN(globalDataAccount.nextPoolId.toNumber());

        // Find the coinflip PDA
        const [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                pool_id.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );

        try {
            // Get the current next_pool_id
            const globalDataBefore = await program.account.globalData.fetch(globalData);
            const expectedPoolId = globalDataBefore.nextPoolId;
            console.log("Expected pool_id for second coinflip:", expectedPoolId.toString());

            // Create the coinflip
            const tx = await program.methods
                .createCoinflip(setNumber, coinflipAmount)
                .accounts({
                    creator: creatorKeypair.publicKey,
                    globalData: globalData,
                    creatorAta: creatorTokenAccount,
                    spinxMint: spinxMint,
                    coinflipPool: coinflipPool,
                    treasuryWallet: new PublicKey(TREASURY_WALLET),
                    tokenAccount: creatorTokenAccount,
                    splEscrow: splEscrow,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .preInstructions([
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
                ])
                .rpc();

            console.log("Create second coinflip transaction signature", tx);

            // Fetch the coinflip pool account
            const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);

            // Verify the coinflip pool was created correctly with incremented pool_id
            assert.equal(coinflipPoolAccount.poolId.toString(), expectedPoolId.toString(),
                `Second coinflip should have pool_id = ${expectedPoolId}`);

            // Verify the global data was updated correctly
            const globalDataAfter = await program.account.globalData.fetch(globalData);
            assert.equal(globalDataAfter.nextPoolId.toString(), (expectedPoolId.toNumber() + 1).toString(),
                `Next pool ID should be incremented to ${expectedPoolId.toNumber() + 1}`);

            console.log("Second coinflip created successfully with pool_id:", coinflipPoolAccount.poolId.toString());
            console.log("Next pool_id is now:", globalDataAfter.nextPoolId.toString());
        } catch (error) {
            console.error("Error creating second coinflip:", error);
            throw error;
        }
    });

    it("Allows a joiner to join a coinflip", async () => {
        const random = randomnessAccountAddress(force.toBuffer(), vrf.programId);
        console.log("random:", random.toBase58())
        console.log("force:", force.toBase58())
        console.log("force data:", force.toBuffer())
        console.log("VRF ID:", vrf.programId.toBase58())

        const globalDataAccount = await program.account.globalData.fetch(globalData);
        // Get a new timestamp for a fresh coinflip
        const pool_id = new BN(globalDataAccount.nextPoolId.toNumber() - 1);
        console.log("Join Pool ID:", pool_id)

        // Find the coinflip PDA
        let [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                pool_id.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );

        try {
            console.log("Created a coinflip for ID:", pool_id.toString());

            //   // Join the coinflip with a different set number
            const joinerSetNumber = 0; // Opposite of creator's choice
            console.log("Joiner joining the coinflip...");

            // Create a new provider with the joiner wallet for signing
            const joinerWallet = new anchor.Wallet(joinerKeypair);
            const joinerProvider = new anchor.AnchorProvider(
                connection,
                joinerWallet,
                { commitment: "confirmed", preflightCommitment: "confirmed" }
            );
            const joinerProgram = new Program(
                program.idl as anchor.Idl, // Cast to Idl type to ensure it's recognized
                joinerProvider
            );

            const tx = await joinerProgram.methods
                .joinCoinflip(pool_id, [...force.toBuffer()], joinerSetNumber, coinflipAmount)
                .accounts({
                    joiner: joinerKeypair.publicKey,
                    globalData: globalData,
                    joinerAta: joinerTokenAccount,
                    spinxMint: spinxMint,
                    coinflipPool: coinflipPool,
                    treasuryWallet: new PublicKey(TREASURY_WALLET),
                    splEscrow: splEscrow,
                    vrf: vrf.programId,
                    config: networkStateAccountAddress(),
                    treasury: new PublicKey("9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR"),
                    random,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .preInstructions([
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
                ])
                .rpc();

            console.log("Join coinflip transaction signature", tx);

            // Fetch the coinflip pool account
            const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);

            // Verify the joiner was added correctly
            assert.equal(coinflipPoolAccount.joinerPlayer.toString(), joinerKeypair.publicKey.toString());
            assert.equal(coinflipPoolAccount.joinerAmount.toString(), coinflipAmount.toString());
            assert.equal(coinflipPoolAccount.joinerSetNumber.toString(), joinerSetNumber.toString());

            // Verify the winner was determined
            assert.notEqual(coinflipPoolAccount.winner.toString(), PublicKey.default.toString(), "Winner should be set");

            console.log("Winner:", coinflipPoolAccount.winner.toString());
            console.log("Creator:", coinflipPoolAccount.creatorPlayer.toString());
            console.log("Joiner:", coinflipPoolAccount.joinerPlayer.toString());

            if (coinflipPoolAccount.winner.toString() === coinflipPoolAccount.creatorPlayer.toString()) {
                console.log("Creator won the coinflip!");
            } else {
                console.log("Joiner won the coinflip!");
            }
        } catch (error) {
            console.error("Error joining coinflip:", error);
            throw error;
        }
    });

    it("Randomness fulfilled", async () => {
        let randomnessFulfilled = await vrf.waitFulfilled(force.toBuffer())
        console.log("Randomness is fulfilled, we can call the result function")
    })

    it("Get the result", async () => {
        const globalDataAccount = await program.account.globalData.fetch(globalData);
        // Get a new timestamp for a fresh coinflip
        const pool_id = new BN(4);
        console.log("Get Result Pool ID:", pool_id.toString())

        // Find the coinflip PDA
        let [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                pool_id.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );

        console.log("CoinflipPool: ", coinflipPool.toBase58())

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );

        console.log("splEscrow: ", splEscrow.toBase58())

        const coinflipData = await program.account.coinflipPool.fetch(coinflipPool)

        const random = randomnessAccountAddress(Buffer.from(coinflipData.force));
        const treasury = new PublicKey("9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR");

        console.log("Program account data: ", await program.account.coinflipPool.fetch(coinflipPool))

        const tx = await program.methods.resultCoinflip(pool_id, coinflipData.force).accounts({
            coinflipPool: coinflipPool,
            splEscrow: splEscrow,
            spinxMint: spinxMint,
            creatorAta: creatorTokenAccount,
            joinerAta: joinerTokenAccount,
            treasury: treasury,
            random,
            config: networkStateAccountAddress(),
            vrf: vrf.programId,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 350000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ])
        .rpc();


        console.log(`CoinFlip {} is finished`, pool_id, tx)

    })

    it("Sets a new fee", async () => {
        const newFee = new BN(2000000); // 0.002 SOL
        const minAmount = new BN(1000000000); // 1 TOKEN
        const newTreasuryWallet = creatorKeypair.publicKey; // Using the creator wallet as the new treasury for testing

        try {
            // Get the current global data
            const globalDataBefore = await program.account.globalData.fetch(globalData);
            console.log("Current fee:", globalDataBefore.coinflipFee.toString());
            console.log("Current treasury wallet:", globalDataBefore.treasuryWallet.toString());

            // Only proceed if the creator is the super admin
            if (globalDataBefore.superAdmin.toString() !== creatorKeypair.publicKey.toString()) {
                console.log("Skipping fee update test - creator is not the super admin");
                return;
            }
            const wallet = provider.wallet.publicKey;

            const tx = await program.methods
                .setGlobalData(newFee, newTreasuryWallet, minAmount)
                .accounts({
                    admin: wallet,
                    globalData: globalData,
                })
                .rpc();

            console.log("Set fee transaction signature", tx);

            // Fetch the global data account
            const globalDataAccount = await program.account.globalData.fetch(globalData);

            // Verify the fee was updated correctly
            assert.equal(globalDataAccount.coinflipFee.toString(), newFee.toString());
            assert.equal(globalDataAccount.treasuryWallet.toString(), newTreasuryWallet.toString());

            console.log("Fee updated successfully to:", globalDataAccount.coinflipFee.toString());
            console.log("Treasury wallet updated to:", globalDataAccount.treasuryWallet.toString());
        } catch (error) {
            console.error("Error setting fee:", error);
            console.log("Skipping fee update test - creator might not be the super admin");
        }
    });

});