use anchor_lang::prelude::*;

// Here are the account structures

// Default Account structures here
#[account]
#[derive(Default)]
pub struct GlobalData {
    pub super_admin: Pubkey,  // 32
    pub fee_wallet: Pubkey,  // 32
    pub coinflip_fee: u64,
    pub spinx_token: Pubkey,
}

#[account]
pub struct CoinflipPool {
    pub start_ts: u64, // 8
    pub claimed: u8, // 1
    pub winner: Pubkey, // 32
    pub pool_amount: u64, // 8
    pub creator_player: Pubkey, // 32
    pub creator_mint: Pubkey, //32
    pub creator_amount: u64, // 8
    pub creator_set_number: u64, // 8
    pub joiner_player: Pubkey, // 32
    pub joiner_mint: Pubkey, //32
    pub joiner_amount: u64, // 8
    pub joiner_set_number: u64 // 8
}