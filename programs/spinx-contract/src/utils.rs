use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke, program::invoke_signed
};

pub const SPINX_TOKEN_ADDRESS: &str = "4QAuuGj2mMjEPwsX61Sx9gwfNLcKVPotSWV3vUZfv28g";
pub const TREASURY_WALLET: &str = "69QQYnDRZ386bbuMV7srfgh4D5dAR51SdyZ1wWtC3CKs";
pub const COINFLIP_FEE: u64 = 5000000;
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

pub fn sol_transfer_with_signer<'a>(
    source: AccountInfo<'a>,
    destination: AccountInfo<'a>,
    system_program: AccountInfo<'a>,
    signers: &[&[&[u8]]; 1],
    amount: u64,
) -> Result<()> {
    let ix = anchor_lang::solana_program::system_instruction::transfer(source.key, destination.key, amount);
    invoke_signed(&ix, &[source, destination, system_program], signers)?;
    Ok(())
}