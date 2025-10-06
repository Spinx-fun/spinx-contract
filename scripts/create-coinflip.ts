import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Spinx } from "../target/types/spinx";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Connection,
    ComputeBudgetProgram,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
    getMint,
} from "@solana/spl-token";
import BN from "bn.js";
import * as dotenv from "dotenv";
import * as bs58 from "bs58";

// Load environment variables
dotenv.config();

// Constants
const GLOBAL_AUTHORITY_SEED = "global-authority";
const COINFLIP_SEED = "coinflip-authority";
const SPINX_TOKEN_ADDRESS = "4QAuuGj2mMjEPwsX61Sx9gwfNLcKVPotSWV3vUZfv28g";
const TREASURY_WALLET = "69QQYnDRZ386bbuMV7srfgh4D5dAR51SdyZ1wWtC3CKs";

// Configuration
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const CREATOR_PRIVATE_KEY = process.env.CREATOR_PRIVATE_KEY;

// Coinflip parameters
const COINFLIP_AMOUNT = new BN(10_000_000_000); // 10 tokens (adjust as needed)
const SET_NUMBER = 1; // 1 for heads, 0 for tails

async function createCoinflip() {
    console.log("🚀 Starting coinflip creation...");

    // Set up connection
    const connection = new Connection(RPC_URL, "confirmed");
    console.log("📡 Connected to:", RPC_URL);

    // Set up creator wallet
    let creatorKeypair: Keypair;
    if (CREATOR_PRIVATE_KEY) {
        const creatorPrivateKey = bs58.decode(CREATOR_PRIVATE_KEY);
        creatorKeypair = Keypair.fromSecretKey(Uint8Array.from(creatorPrivateKey));
        console.log("👤 Using creator wallet from .env:", creatorKeypair.publicKey.toString());
    } else {
        console.error("❌ CREATOR_PRIVATE_KEY not found in environment variables");
        console.log("Please set CREATOR_PRIVATE_KEY in your .env file");
        return;
    }

    // Create wallet adapter and provider
    const creatorWallet = new anchor.Wallet(creatorKeypair);
    const provider = new anchor.AnchorProvider(
        connection,
        creatorWallet,
        { commitment: "confirmed", preflightCommitment: "confirmed" }
    );

    // Set the provider for Anchor
    anchor.setProvider(provider);

    // Get the program from IDL
    const program = anchor.workspace.Spinx as Program<Spinx>;

    try {
        // Find global data PDA
        const [globalDataPda] = await PublicKey.findProgramAddressSync(
            [Buffer.from(GLOBAL_AUTHORITY_SEED)],
            program.programId
        );
        console.log("🌐 Global Data PDA:", globalDataPda.toString());

        // Get global data to check current pool ID
        const globalDataAccount = await program.account.globalData.fetch(globalDataPda);
        const poolId = new BN(globalDataAccount.nextPoolId.toNumber());
        console.log("🎯 Next Pool ID:", poolId.toString());
        console.log("🏦 Expected Treasury Wallet:", globalDataAccount.treasuryWallet.toString());
        console.log("🏦 Script Treasury Wallet:", TREASURY_WALLET);

        // Find the coinflip PDA
        const [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                poolId.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );
        console.log("🎲 Coinflip Pool PDA:", coinflipPool.toString());

        // Set up token accounts
        const spinxMint = new PublicKey(SPINX_TOKEN_ADDRESS);
        console.log("🪙 SPINX Token:", spinxMint.toString());

        // Get or create creator token account
        const creatorTokenAccount = await getAssociatedTokenAddress(
            spinxMint,
            creatorKeypair.publicKey
        );

        // Check if creator has sufficient tokens
        try {
            const creatorTokenInfo = await getAccount(connection, creatorTokenAccount);
            const creatorBalance = Number(creatorTokenInfo.amount);
            console.log("💰 Creator token balance:", creatorBalance / 10 ** 9, "tokens");

            if (creatorBalance < COINFLIP_AMOUNT.toNumber()) {
                console.error("❌ Insufficient token balance. Required:", COINFLIP_AMOUNT.toString(), "Available:", creatorBalance);
                return;
            }
        } catch (error) {
            console.error("❌ Error checking creator token balance:", error);
            return;
        }

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );
        console.log("🏦 SPL Escrow:", splEscrow.toString());

        // Check creator SOL balance
        const creatorBalance = await connection.getBalance(creatorKeypair.publicKey);
        console.log("💎 Creator SOL balance:", creatorBalance / LAMPORTS_PER_SOL, "SOL");

        if (creatorBalance < LAMPORTS_PER_SOL / 2) {
            console.warn("⚠️ Warning: Creator wallet has low SOL balance. Transaction may fail.");
        }

        console.log("🎯 Creating coinflip with:");
        console.log("   - Amount:", COINFLIP_AMOUNT.toString(), "tokens");
        console.log("   - Set Number:", SET_NUMBER, "(1=heads, 0=tails)");
        console.log("   - Pool ID:", poolId.toString());

        // Verify the PDA derivation
        console.log("🔍 Verifying PDA derivation:");
        console.log("   - COINFLIP_SEED:", COINFLIP_SEED);
        console.log("   - Pool ID buffer:", poolId.toArrayLike(Buffer, "le", 8));
        console.log("   - Derived coinflipPool:", coinflipPool.toString());

        // Use the treasury wallet from global data
        const treasuryWallet = globalDataAccount.treasuryWallet;
        console.log("🏦 Using Treasury Wallet:", globalDataAccount, treasuryWallet.toString());

        // Create the coinflip transaction
        const tx = await program.methods
            .createCoinflip(SET_NUMBER, COINFLIP_AMOUNT)
            .accounts({
                creator: creatorKeypair.publicKey,
                //@ts-ignore
                globalData: globalDataPda,
                creatorAta: creatorTokenAccount,
                spinxMint: spinxMint,
                coinflipPool: coinflipPool,
                treasuryWallet: treasuryWallet,
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

        console.log("✅ Coinflip created successfully!");
        console.log("📝 Transaction signature:", tx);
        console.log("🔗 View on Solana Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

        // Fetch and display the created coinflip details
        const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);
        console.log("\n📊 Coinflip Details:");
        console.log("   - Pool ID:", coinflipPoolAccount.poolId.toString());
        console.log("   - Creator:", coinflipPoolAccount.creatorPlayer.toString());
        console.log("   - Amount:", coinflipPoolAccount.creatorAmount.toString());
        console.log("   - Set Number:", coinflipPoolAccount.creatorSetNumber.toString());
        console.log("   - Status:", coinflipPoolAccount.status);
        console.log("   - Pool Amount:", coinflipPoolAccount.poolAmount.toString());

        // Get updated global data
        const globalDataAfter = await program.account.globalData.fetch(globalDataPda);
        console.log("🔄 Next Pool ID is now:", globalDataAfter.nextPoolId.toString());

    } catch (error) {
        console.error("❌ Error creating coinflip:", error);
        
        if (error instanceof Error) {
            console.error("Error message:", error.message);
            if (error.message.includes("insufficient funds")) {
                console.log("💡 Tip: Make sure you have enough SOL and SPINX tokens");
            }
        }
    }
}

// Run the script
if (require.main === module) {
    createCoinflip()
        .then(() => {
            console.log("🎉 Script completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Script failed:", error);
            process.exit(1);
        });
}

export { createCoinflip };
