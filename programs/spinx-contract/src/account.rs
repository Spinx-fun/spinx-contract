use anchor_lang::prelude::*;

// Here are the account structures

// Default Account structures here
#[account]
#[derive(Default)]
pub struct GlobalData {
    pub super_admin: Pubkey,  // 32
    pub treasury_wallet: Pubkey,  // 32
    pub coinflip_fee: u64,
    pub spinx_token: Pubkey,
    pub next_pool_id: u64,
}

#[account]
pub struct CoinflipPool {
    pub pool_id: u64, //8
    pub start_ts: u64, // 8
    pub bump: u8, // 1
    pub winner: Pubkey, // 32
    pub pool_amount: u64, // 8
    pub creator_player: Pubkey, // 32
    pub creator_ata: Pubkey, //32
    pub creator_amount: u64, // 8
    pub creator_set_number: u64, // 8
    pub joiner_player: Pubkey, // 32
    pub joiner_ata: Pubkey, //32
    pub joiner_amount: u64, // 8
    pub joiner_set_number: u64 // 8
}