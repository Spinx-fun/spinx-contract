import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Spinx } from "./target/types/spinx";
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
import { networkStateAccountAddress, Orao, randomnessAccountAddress } from "@orao-network/solana-vrf";

// Load environment variables
dotenv.config();

// Constants
const GLOBAL_AUTHORITY_SEED = "global-authority";
const COINFLIP_SEED = "coinflip-authority";
const SPINX_TOKEN_ADDRESS = "4QAuuGj2mMjEPwsX61Sx9gwfNLcKVPotSWV3vUZfv28g";
const TREASURY_WALLET = "69QQYnDRZ386bbuMV7srfgh4D5dAR51SdyZ1wWtC3CKs";

// Configuration
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const JOINER_PRIVATE_KEY = process.env.JOINER_PRIVATE_KEY;

// Join parameters
const COINFLIP_AMOUNT = new BN(10_000_000_000); // 10 tokens (adjust as needed)
const JOINER_SET_NUMBER = 0; // 0 for tails, 1 for heads (opposite of creator)
const POOL_ID = 1; // Specify which pool to join (adjust as needed)

async function joinCoinflip() {
    console.log("🎲 Starting coinflip join...");

    // Set up connection
    const connection = new Connection(RPC_URL, "confirmed");
    console.log("📡 Connected to:", RPC_URL);

    // Set up joiner wallet
    let joinerKeypair: Keypair;
    if (JOINER_PRIVATE_KEY) {
        const joinerPrivateKey = bs58.decode(JOINER_PRIVATE_KEY);
        joinerKeypair = Keypair.fromSecretKey(Uint8Array.from(joinerPrivateKey));
        console.log("👤 Using joiner wallet from .env:", joinerKeypair.publicKey.toString());
    } else {
        console.error("❌ JOINER_PRIVATE_KEY not found in environment variables");
        console.log("Please set JOINER_PRIVATE_KEY in your .env file");
        return;
    }

    // Create wallet adapter and provider
    const joinerWallet = new anchor.Wallet(joinerKeypair);
    const provider = new anchor.AnchorProvider(
        connection,
        joinerWallet,
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

        // Get global data
        const globalDataAccount = await program.account.globalData.fetch(globalDataPda);
        console.log("🏦 Treasury Wallet:", globalDataAccount.treasuryWallet.toString());

        // Find the coinflip PDA
        const poolId = new BN(POOL_ID);
        const [coinflipPool] = await PublicKey.findProgramAddressSync(
            [
                Buffer.from(COINFLIP_SEED),
                poolId.toArrayLike(Buffer, "le", 8),
            ],
            program.programId
        );
        console.log("🎲 Coinflip Pool PDA:", coinflipPool.toString());

        // Check if the coinflip exists
        try {
            const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);
            console.log("📊 Existing Coinflip Details:");
            console.log("   - Pool ID:", coinflipPoolAccount.poolId.toString());
            console.log("   - Creator:", coinflipPoolAccount.creatorPlayer.toString());
            console.log("   - Creator Amount:", coinflipPoolAccount.creatorAmount.toString());
            console.log("   - Creator Set Number:", coinflipPoolAccount.creatorSetNumber.toString());
            console.log("   - Status:", coinflipPoolAccount.status);
            console.log("   - Pool Amount:", coinflipPoolAccount.poolAmount.toString());

            // Check if already has a joiner
            if (coinflipPoolAccount.joinerPlayer.toString() !== PublicKey.default.toString()) {
                console.log("❌ This coinflip already has a joiner:", coinflipPoolAccount.joinerPlayer.toString());
                return;
            }

            // Check if creator is trying to join their own coinflip
            if (coinflipPoolAccount.creatorPlayer.toString() === joinerKeypair.publicKey.toString()) {
                console.log("❌ You cannot join your own coinflip");
                return;
            }

            // Check if set numbers are different
            if (coinflipPoolAccount.creatorSetNumber === JOINER_SET_NUMBER) {
                console.log("❌ You must choose a different set number than the creator");
                console.log("   - Creator chose:", coinflipPoolAccount.creatorSetNumber);
                console.log("   - You chose:", JOINER_SET_NUMBER);
                return;
            }

        } catch (error) {
            console.error("❌ Error fetching coinflip pool:", error);
            console.log("   - Make sure the pool ID exists");
            console.log("   - Current pool ID:", POOL_ID);
            return;
        }

        // Set up token accounts
        const spinxMint = new PublicKey(SPINX_TOKEN_ADDRESS);
        console.log("🪙 SPINX Token:", spinxMint.toString());

        // Get or create joiner token account
        const joinerTokenAccount = await getAssociatedTokenAddress(
            spinxMint,
            joinerKeypair.publicKey
        );

        // Check if joiner has sufficient tokens
        try {
            const joinerTokenInfo = await getAccount(connection, joinerTokenAccount);
            const joinerBalance = Number(joinerTokenInfo.amount);
            console.log("💰 Joiner token balance:", joinerBalance / 10 ** 9, "tokens");

            if (joinerBalance < COINFLIP_AMOUNT.toNumber()) {
                console.error("❌ Insufficient token balance. Required:", COINFLIP_AMOUNT.toString(), "Available:", joinerBalance);
                return;
            }
        } catch (error) {
            console.error("❌ Error checking joiner token balance:", error);
            return;
        }

        // Find the SPL escrow account
        const splEscrow = await getAssociatedTokenAddress(
            spinxMint,
            coinflipPool,
            true
        );
        console.log("🏦 SPL Escrow:", splEscrow.toString());

        // Check joiner SOL balance
        const joinerBalance = await connection.getBalance(joinerKeypair.publicKey);
        console.log("💎 Joiner SOL balance:", joinerBalance / LAMPORTS_PER_SOL, "SOL");

        if (joinerBalance < LAMPORTS_PER_SOL / 2) {
            console.warn("⚠️ Warning: Joiner wallet has low SOL balance. Transaction may fail.");
        }

        // Set up VRF
        const vrf = new Orao(provider);
        const force = Keypair.generate().publicKey;
        const random = randomnessAccountAddress(force.toBuffer(), vrf.programId);
        
        console.log("🎲 VRF Setup:");
        console.log("   - Force:", force.toString());
        console.log("   - Random:", random.toString());
        console.log("   - VRF Program:", vrf.programId.toString());

        console.log("🎯 Joining coinflip with:");
        console.log("   - Pool ID:", POOL_ID);
        console.log("   - Amount:", COINFLIP_AMOUNT.toString(), "tokens");
        console.log("   - Set Number:", JOINER_SET_NUMBER, "(0=tails, 1=heads)");

        // Create the join coinflip transaction
        const tx = await program.methods
            .joinCoinflip(poolId, [...force.toBuffer()], JOINER_SET_NUMBER, COINFLIP_AMOUNT)
            .accounts({
                joiner: joinerKeypair.publicKey,
                //@ts-ignore
                globalData: globalDataPda,
                joinerAta: joinerTokenAccount,
                spinxMint: spinxMint,
                coinflipPool: coinflipPool,
                treasuryWallet: globalDataAccount.treasuryWallet,
                splEscrow: splEscrow,
                vrf: vrf.programId,
                config: networkStateAccountAddress(),
                treasury: globalDataAccount.treasuryWallet, // Use same as treasuryWallet
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

        console.log("✅ Successfully joined coinflip!");
        console.log("📝 Transaction signature:", tx);
        console.log("🔗 View on Solana Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

        // Fetch and display the updated coinflip details
        const coinflipPoolAccount = await program.account.coinflipPool.fetch(coinflipPool);
        console.log("\n📊 Updated Coinflip Details:");
        console.log("   - Pool ID:", coinflipPoolAccount.poolId.toString());
        console.log("   - Creator:", coinflipPoolAccount.creatorPlayer.toString());
        console.log("   - Creator Amount:", coinflipPoolAccount.creatorAmount.toString());
        console.log("   - Creator Set Number:", coinflipPoolAccount.creatorSetNumber.toString());
        console.log("   - Joiner:", coinflipPoolAccount.joinerPlayer.toString());
        console.log("   - Joiner Amount:", coinflipPoolAccount.joinerAmount.toString());
        console.log("   - Joiner Set Number:", coinflipPoolAccount.joinerSetNumber.toString());
        console.log("   - Status:", coinflipPoolAccount.status);
        console.log("   - Pool Amount:", coinflipPoolAccount.poolAmount.toString());
        console.log("   - Winner:", coinflipPoolAccount.winner.toString());

        if (coinflipPoolAccount.winner.toString() !== PublicKey.default.toString()) {
            if (coinflipPoolAccount.winner.toString() === coinflipPoolAccount.creatorPlayer.toString()) {
                console.log("🏆 Creator won the coinflip!");
            } else {
                console.log("🏆 Joiner won the coinflip!");
            }
        } else {
            console.log("⏳ Winner will be determined after randomness is fulfilled");
        }

    } catch (error) {
        console.error("❌ Error joining coinflip:", error);
        
        if (error instanceof Error) {
            console.error("Error message:", error.message);
            if (error.message.includes("insufficient funds")) {
                console.log("💡 Tip: Make sure you have enough SOL and SPINX tokens");
            }
            if (error.message.includes("AlreadyDrawn")) {
                console.log("💡 Tip: This coinflip already has a winner");
            }
            if (error.message.includes("InvalidJoiner")) {
                console.log("💡 Tip: You cannot join your own coinflip");
            }
            if (error.message.includes("InvalidNumber")) {
                console.log("💡 Tip: You must choose a different set number than the creator");
            }
        }
    }
}

// Run the script
if (require.main === module) {
    joinCoinflip()
        .then(() => {
            console.log("🎉 Script completed");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Script failed:", error);
            process.exit(1);
        });
}

export { joinCoinflip };
