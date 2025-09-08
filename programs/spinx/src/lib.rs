use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub mod account;
pub mod utils;
pub mod error;

use account::*;
use utils::*;
use error::*;

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("5eRgNNcptvjHxXBVrMBzXEx8QxB79vbL94DJCNgLiMcV");

#[program]
pub mod spinx {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let global_data = &mut ctx.accounts.global_data;
        global_data.super_admin = ctx.accounts.admin.key();
        global_data.fee_wallet = FEE_WALLET.parse::<Pubkey>().unwrap();
        global_data.spinx_token = SPINX_TOKEN_ADDRESS.parse::<Pubkey>().unwrap();
        global_data.coinflip_fee = COINFLIP_FEE;

        Ok(())
    }

    pub fn set_fee(ctx: Context<SetFee>, coinflip_fee: u64, fee_wallet: Pubkey) -> Result<()> {
        let global_data = &mut ctx.accounts.global_data;
        global_data.coinflip_fee = coinflip_fee;
        global_data.fee_wallet = fee_wallet;

        Ok(())
    }

    pub fn create_coinflip(ctx: Context<CreateCoinflip>, ts: u64, set_number: u64, amount: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;
        let global_data = &mut ctx.accounts.global_data;
        
        let fee = global_data.coinflip_fee;

        // Transfer fee to sol_vault
        sol_transfer_user(
            ctx.accounts.admin.to_account_info().clone(), 
            ctx.accounts.sol_vault.to_account_info().clone(), 
            ctx.accounts.system_program.to_account_info().clone(), 
            fee
        )?;

        // Transfer amount SPL token to spl_escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.spl_escrow.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_account.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        coinflip_pool.start_ts = ts;
        coinflip_pool.creator_player = ctx.accounts.admin.key();
        coinflip_pool.creator_amount = amount;
        coinflip_pool.creator_mint = global_data.spinx_token;
        coinflip_pool.creator_set_number = set_number;
        coinflip_pool.pool_amount = amount;

        Ok(())
    }

    pub fn join_coinflip(ctx: Context<JoinCoinflip>, set_number: u64, amount: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;
        let global_data = &mut ctx.accounts.global_data;
        let fee = global_data.coinflip_fee;
        
        require!(coinflip_pool.claimed == 0, SpinXError::AlreadyClaimed);
        require!(coinflip_pool.winner == Pubkey::default(), SpinXError::AlreadyDrawn);
        require!(coinflip_pool.creator_player != ctx.accounts.admin.key(), SpinXError::InvalidJoiner);
        require!(coinflip_pool.creator_set_number != set_number, SpinXError::InvalidNumber);

        // Transfer amount + fee SPL token to spl_escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.spl_escrow.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Transfer fee to sol_vault
        sol_transfer_user(
            ctx.accounts.admin.to_account_info().clone(), 
            ctx.accounts.sol_vault.to_account_info().clone(), 
            ctx.accounts.system_program.to_account_info().clone(), 
            fee
        )?;
    

        coinflip_pool.joiner_player = ctx.accounts.admin.key();
        coinflip_pool.joiner_amount = amount;
        coinflip_pool.joiner_mint = global_data.spinx_token;
        coinflip_pool.joiner_set_number = set_number;
        coinflip_pool.pool_amount += amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        space = 8 + 32 + 32 + 8 + 8 + 24 + 32 * 4 + 8 * 5,
        seeds = [GLOBAL_AUTHORITY_SEED.as_ref()],
        bump,
        payer = admin
    )]
    pub global_data: Box<Account<'info, GlobalData>>,


    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetFee <'info> {
    #[account(
        mut,
        constraint = 
            admin.key() == global_data.super_admin @ SpinXError::InvalidAdmin
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_AUTHORITY_SEED.as_ref()],
        bump
    )]
    pub global_data: Box<Account<'info, GlobalData>>,
}

#[derive(Accounts)]
#[instruction(
    ts: u64
)]
pub struct CreateCoinflip<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_AUTHORITY_SEED.as_ref()],
        bump
    )]
    pub global_data: Box<Account<'info, GlobalData>>,

    #[account(
        init,
        space = 8 + 8 + 1 + 32 + 8 + 80 + 80,
        seeds = [COINFLIP_SEED.as_ref(), admin.to_account_info().key.as_ref(), ts.to_le_bytes().as_ref()],
        bump,
        payer = admin
    )]
    pub coinflip_pool: Box<Account<'info, CoinflipPool>>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_ref()],
        bump,
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    #[account(mut)]
    pub token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub spl_escrow: Box<Account<'info, TokenAccount>>,

    /// CHECK:` doc comment explaining why no checks through types are necessary.
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct JoinCoinflip<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_AUTHORITY_SEED.as_ref()],
        bump
    )]
    pub global_data: Box<Account<'info, GlobalData>>,

    #[account(mut)]
    pub coinflip_pool: Account<'info, CoinflipPool>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_ref()],
        bump,
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    #[account(mut)]
    pub token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub spl_escrow: Box<Account<'info, TokenAccount>>,
    
    /// CHECK:` doc comment explaining why no checks through types are necessary.
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}