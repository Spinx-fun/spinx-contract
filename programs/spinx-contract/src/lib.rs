use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

pub mod account;
pub mod utils;
pub mod error;

use account::*;
use utils::*;
use error::*;

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("GjbMbmaKX8jB5TrH91AZ6xZwFPeq7fgPkZVDhjGcBUdd");

#[program]
pub mod spinx {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let global_data = &mut ctx.accounts.global_data;
        global_data.super_admin = ctx.accounts.admin.key();
        global_data.treasury_wallet = TREASURY_WALLET.parse::<Pubkey>().unwrap();
        global_data.spinx_token = SPINX_TOKEN_ADDRESS.parse::<Pubkey>().unwrap();
        global_data.coinflip_fee = COINFLIP_FEE;
        global_data.next_pool_id = 1; // Initialize the pool ID count

        Ok(())
    }

    pub fn set_fee(ctx: Context<SetFee>, coinflip_fee: u64, treasury_wallet: Pubkey) -> Result<()> {
        let global_data = &mut ctx.accounts.global_data;
        global_data.coinflip_fee = coinflip_fee;
        global_data.treasury_wallet = treasury_wallet;

        Ok(())
    }

    pub fn create_coinflip(ctx: Context<CreateCoinflip>, set_number: u64, amount: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;
        let global_data = &mut ctx.accounts.global_data;
        
        let fee = global_data.coinflip_fee;

        // Transfer fee to sol_vault
        sol_transfer_user(
            ctx.accounts.creator.to_account_info().clone(), 
            ctx.accounts.sol_vault.to_account_info().clone(), 
            ctx.accounts.system_program.to_account_info().clone(), 
            fee
        )?;

        // Transfer amount SPL token to spl_escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_ata.to_account_info(),
            to: ctx.accounts.spl_escrow.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.creator_ata.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Generate the random number
        let timestamp = Clock::get()?.unix_timestamp;

        // Assign the current pool_id to this coinflip pool
        coinflip_pool.pool_id = global_data.next_pool_id;

        // Increment the next_pool_id for the next coinflip
        global_data.next_pool_id += 1;

        coinflip_pool.start_ts = timestamp as u64;
        coinflip_pool.creator_player = ctx.accounts.creator.key();
        coinflip_pool.creator_amount = amount;
        coinflip_pool.creator_ata = ctx.accounts.creator_ata.key();
        coinflip_pool.creator_set_number = set_number;
        coinflip_pool.pool_amount = amount;
        coinflip_pool.bump = ctx.bumps.coinflip_pool;

        Ok(())
    }

    pub fn join_coinflip(ctx: Context<JoinCoinflip>, pool_id: u64, set_number: u64, amount: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;        
        let global_data = &mut ctx.accounts.global_data;
        let fee = global_data.coinflip_fee;
        
        require!(coinflip_pool.winner == Pubkey::default(), SpinXError::AlreadyDrawn);
        require!(coinflip_pool.creator_player != ctx.accounts.joiner.key(), SpinXError::InvalidJoiner);
        require!(coinflip_pool.creator_set_number != set_number, SpinXError::InvalidNumber);

        // Transfer amount SPL token to spl_escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.joiner_ata.to_account_info(),
            to: ctx.accounts.spl_escrow.to_account_info(),
            authority: ctx.accounts.joiner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Transfer fee to Treasury
        sol_transfer_user(
            ctx.accounts.joiner.to_account_info().clone(), 
            ctx.accounts.sol_vault.to_account_info().clone(), 
            ctx.accounts.system_program.to_account_info().clone(), 
            fee
        )?;
    
        // Generate the random number
        let timestamp = Clock::get()?.unix_timestamp;
        // Get the random number of the entrant amount
        let (joiner_address, _bump) = Pubkey::find_program_address(
            &[
                RANDOM_SEED.as_bytes(),
                timestamp.to_string().as_bytes(),
            ],
            &spinx::ID,
        );
        let char_vec: Vec<char> = joiner_address.to_string().chars().collect();
        let mut mul = 1;
        for i in 0..7 {
            mul *= u64::from(char_vec[i as usize]);
        }
        mul += u64::from(char_vec[7]);

        coinflip_pool.joiner_player = ctx.accounts.joiner.key();
        coinflip_pool.joiner_amount = amount;
        coinflip_pool.joiner_ata = ctx.accounts.joiner_ata.key();
        coinflip_pool.joiner_set_number = set_number;
        coinflip_pool.pool_amount += amount;

        let seeds = &[
                COINFLIP_SEED.as_bytes(), &pool_id.to_le_bytes(),
                &[coinflip_pool.bump],
            ];
        let signer = &[&seeds[..]]; 

        if mul % 2 == set_number { // Win
            coinflip_pool.winner = coinflip_pool.joiner_player;

            let cpi_accounts = Transfer {
                from: ctx.accounts.spl_escrow.to_account_info(),
                to: ctx.accounts.joiner_ata.to_account_info(),
                authority: coinflip_pool.to_account_info(),
            };
            
            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
            token::transfer(cpi_ctx, coinflip_pool.pool_amount)?;   

        } else { // Lost
            coinflip_pool.winner = coinflip_pool.creator_player;

            let cpi_accounts = Transfer {
                from: ctx.accounts.spl_escrow.to_account_info(),
                to: ctx.accounts.creator_ata.to_account_info(),
                authority: coinflip_pool.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
            token::transfer(cpi_ctx, coinflip_pool.pool_amount)?;
        }

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
        seeds = [GLOBAL_AUTHORITY_SEED.as_bytes()],
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
        seeds = [GLOBAL_AUTHORITY_SEED.as_bytes()],
        bump
    )]
    pub global_data: Box<Account<'info, GlobalData>>,
}

#[derive(Accounts)]
pub struct CreateCoinflip<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_AUTHORITY_SEED.as_bytes()],
        bump
    )]
    pub global_data: Box<Account<'info, GlobalData>>,

    // Initialize player token account if it doesn't exist
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = spinx_mint,
        associated_token::authority = creator
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    #[account(address = global_data.spinx_token)]
    pub spinx_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        space = 8 + 8 + 1 + 32 + 8 + 80 + 80 + 8,
        seeds = [COINFLIP_SEED.as_bytes(), global_data.next_pool_id.to_le_bytes().as_ref()],
        bump,
        payer = creator
    )]
    pub coinflip_pool: Box<Account<'info, CoinflipPool>>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump,
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool
    )]
    pub spl_escrow: Account<'info, TokenAccount>,

    /// CHECK:` doc comment explaining why no checks through types are necessary.
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(
    pool_id: u64
)]
pub struct JoinCoinflip<'info> {
    #[account(mut)]
    pub joiner: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_AUTHORITY_SEED.as_bytes()],
        bump
    )]
    pub global_data: Box<Account<'info, GlobalData>>,

    // Initialize player token account if it doesn't exist
    #[account(
        init_if_needed,
        payer = joiner,
        associated_token::mint = spinx_mint,
        associated_token::authority = joiner
    )]
    pub joiner_ata: Account<'info, TokenAccount>,

    #[account(address = global_data.spinx_token)]
    pub spinx_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [COINFLIP_SEED.as_bytes(), pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub coinflip_pool: Account<'info, CoinflipPool>,

    #[account(address = coinflip_pool.creator_ata)]
    pub creator_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump,
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool
    )]
    pub spl_escrow: Account<'info, TokenAccount>,
    
    /// CHECK:` doc comment explaining why no checks through types are necessary.
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}