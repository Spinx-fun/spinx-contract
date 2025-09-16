use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke
};

pub const SPINX_TOKEN_ADDRESS: &str = "EY4wsByMUEudm4FRC2nTFfmiWFCMdhJx5j69ZTfQ8mz6";
pub const TREASURY_WALLET: &str = "EAoVpYvC3jNp1F9nym6KGXWGvyBw3PpNKWY4Dd3D8aao";
pub const COINFLIP_FEE: u64 = 1000000;
pub const GLOBAL_AUTHORITY_SEED: &str = "global-authority";
pub const VAULT_SEED: &str = "vault-authority";
pub const GAME_SEED: &str = "game-authority";
pub const COINFLIP_SEED: &str = "coinflip-authority";
pub const SPL_ESCROW_SEED: &str = "spl-escrow";
pub const RANDOM_SEED: &str = "random";

// Here are some normal sample functions here
pub fn sol_transfer_user<'a>(
    source: AccountInfo<'a>,
    destination: AccountInfo<'a>,
    system_program: AccountInfo<'a>,
    amount: u64,
) -> Result<()> {
    let ix = anchor_lang::solana_program::system_instruction::transfer(source.key, destination.key, amount);
    invoke(&ix, &[source, destination, system_program])?;
    Ok(())
}