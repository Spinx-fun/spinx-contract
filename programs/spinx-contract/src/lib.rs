use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

mod misc;
pub mod account;
pub mod utils;
pub mod error;

use account::*;
use utils::*;
use error::*;

use orao_solana_vrf::program::OraoVrf;
use orao_solana_vrf::state::NetworkState;
use orao_solana_vrf::CONFIG_ACCOUNT_SEED;
use orao_solana_vrf::RANDOMNESS_ACCOUNT_SEED;

#[cfg(not(feature = "no-entrypoint"))]
use {solana_security_txt::security_txt};

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "SPINX",
    project_url: "https://spinx.fun",
    contacts: "email:support@spinx.fun",
    policy: "https://spinx.fun",

    // Optional Fields
    preferred_languages: "en,de",
    source_code: "https://github.com/Spinx-fun/spinx-contract",
    source_release: "",
    encryption: ""
}

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("CK9bscEwv3uJRrtVFCaf55ascDR7ufgdk4udGsAWWbi8");

#[program]
pub mod spinx {
    use orao_solana_vrf::cpi::accounts::RequestV2;

    use self::misc::current_state;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let global_data = &mut ctx.accounts.global_data;
        global_data.super_admin = ctx.accounts.admin.key();
        global_data.treasury_wallet = TREASURY_WALLET.parse::<Pubkey>().unwrap();
        global_data.spinx_token = SPINX_TOKEN_ADDRESS.parse::<Pubkey>().unwrap();
        global_data.coinflip_fee = COINFLIP_FEE;
        global_data.min_amount = 10000000000;
        global_data.next_pool_id = 1; // Initialize the pool ID count

        Ok(())
    }

    pub fn set_global_data(ctx: Context<SetGlobalData>, coinflip_fee: u64, treasury_wallet: Pubkey, min_amount: u64) -> Result<()> {
        let global_data = &mut ctx.accounts.global_data;
        global_data.coinflip_fee = coinflip_fee;
        global_data.treasury_wallet = treasury_wallet;
        global_data.min_amount = min_amount;

        Ok(())
    }

    pub fn create_coinflip(ctx: Context<CreateCoinflip>, set_number: u8, amount: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;
        let global_data = &mut ctx.accounts.global_data;

        require!( amount >= global_data.min_amount, SpinXError::AmountTooSmall);
        
        let fee = global_data.coinflip_fee;

        // Transfer fee directly to treasury
        sol_transfer_user(
            ctx.accounts.creator.to_account_info().clone(), 
            ctx.accounts.treasury_wallet.to_account_info().clone(), 
            ctx.accounts.system_program.to_account_info().clone(), 
            fee
        )?;

        // Transfer amount SPL token to spl_escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_ata.to_account_info(),
            to: ctx.accounts.spl_escrow.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
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

    pub fn join_coinflip(ctx: Context<JoinCoinflip>, pool_id: u64, force: [u8; 32], set_number: u8, amount: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;        
        let global_data = &mut ctx.accounts.global_data;
        let fee = global_data.coinflip_fee;
        
        require!(coinflip_pool.winner == Pubkey::default(), SpinXError::AlreadyDrawn);
        require!(coinflip_pool.creator_player != ctx.accounts.joiner.key(), SpinXError::InvalidJoiner);
        require!(coinflip_pool.creator_set_number != set_number, SpinXError::InvalidNumber);
        require!(coinflip_pool.creator_amount == amount, SpinXError::InvalidAmount);

        // Transfer amount SPL token to spl_escrow
        let cpi_accounts = Transfer {
            from: ctx.accounts.joiner_ata.to_account_info(),
            to: ctx.accounts.spl_escrow.to_account_info(),
            authority: ctx.accounts.joiner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Transfer fee directly to treasury
        sol_transfer_user(
            ctx.accounts.joiner.to_account_info().clone(), 
            ctx.accounts.treasury_wallet.to_account_info().clone(), 
            ctx.accounts.system_program.to_account_info().clone(), 
            fee
        )?;
        
        // Request randomness.
        let cpi_program = ctx.accounts.vrf.to_account_info();
        let cpi_accounts = RequestV2 {
            payer: ctx.accounts.joiner.to_account_info(),
            network_state: ctx.accounts.config.to_account_info(),
            treasury: ctx.accounts.treasury.to_account_info(),
            request: ctx.accounts.random.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        orao_solana_vrf::cpi::request_v2(cpi_ctx, force)?;
        
        coinflip_pool.joiner_player = ctx.accounts.joiner.key();
        coinflip_pool.joiner_amount = amount;
        coinflip_pool.joiner_ata = ctx.accounts.joiner_ata.key();
        coinflip_pool.joiner_set_number = set_number;
        coinflip_pool.pool_amount += amount;
        coinflip_pool.force = force;
        coinflip_pool.status = PoolStatus::Processing;        

        Ok(())
    }

    pub fn close_coinflip(ctx: Context<CloseCoinflip>, pool_id: u64) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;        
        
        require!(coinflip_pool.creator_player == ctx.accounts.signer.key(), SpinXError::InvalidCreator);
        require!(coinflip_pool.status != PoolStatus::Waiting, SpinXError::InvalidClaimStatus);

        let seeds = &[
                COINFLIP_SEED.as_bytes(), &pool_id.to_le_bytes(),
                &[coinflip_pool.bump],
            ];
        let signer = &[&seeds[..]]; 

        let cpi_accounts = Transfer {
            from: ctx.accounts.spl_escrow.to_account_info(),
            to: ctx.accounts.creator_ata.to_account_info(),
            authority: coinflip_pool.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
        token::transfer(cpi_ctx, coinflip_pool.creator_amount)?;  

        coinflip_pool.status = PoolStatus::Closed;
        coinflip_pool.pool_amount = 0;
        Ok(())
    }

    pub fn result_coinflip(ctx: Context<ResultCoinflip>, pool_id: u64, force: [u8; 32]) -> Result<()> {
        let coinflip_pool = &mut ctx.accounts.coinflip_pool;
        let rand_acc = crate::misc::get_account_data(&ctx.accounts.random)?;        

        require!(coinflip_pool.status == PoolStatus::Processing, SpinXError::InvalidPoolStatus);

        let randomness = current_state(&rand_acc);
        if randomness == 0 {
            return err!(SpinXError::StillProcessing)
        }
        let result = (randomness % 2) as u8;

        msg!("VRF result is: {}", randomness);

        let seeds = &[
                COINFLIP_SEED.as_bytes(), &pool_id.to_le_bytes(),
                &[coinflip_pool.bump],
            ];
        let signer = &[&seeds[..]]; 

        if result == coinflip_pool.joiner_set_number { // Win Joiner
            coinflip_pool.winner = coinflip_pool.joiner_player;

            let cpi_accounts = Transfer {
                from: ctx.accounts.spl_escrow.to_account_info(),
                to: ctx.accounts.joiner_ata.to_account_info(),
                authority: coinflip_pool.to_account_info(),
            };
            
            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
            token::transfer(cpi_ctx, coinflip_pool.pool_amount)?;   

        } else { // Win Creator
            coinflip_pool.winner = coinflip_pool.creator_player;

            let cpi_accounts = Transfer {
                from: ctx.accounts.spl_escrow.to_account_info(),
                to: ctx.accounts.creator_ata.to_account_info(),
                authority: coinflip_pool.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
            token::transfer(cpi_ctx, coinflip_pool.pool_amount)?;
        }

        coinflip_pool.status = PoolStatus::Finished;
        coinflip_pool.pool_amount = 0;

        msg!("Coinflip game in room {} has concluded, the winner is {}", pool_id, coinflip_pool.winner.to_string());        

        Ok(())
    }


}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        space = 8 + std::mem::size_of::<GlobalData>(),
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
pub struct SetGlobalData <'info> {
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
        space = 8 + std::mem::size_of::<CoinflipPool>(),
        seeds = [COINFLIP_SEED.as_bytes(), global_data.next_pool_id.to_le_bytes().as_ref()],
        bump,
        payer = creator
    )]
    pub coinflip_pool: Box<Account<'info, CoinflipPool>>,

    #[account(
        mut,
        constraint = 
            treasury_wallet.key() == global_data.treasury_wallet @ SpinXError::OwnerMismatch
    )]
    pub treasury_wallet: SystemAccount<'info>,

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
    pool_id: u64, force: [u8; 32]
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

    #[account(
        mut,
        constraint = 
            treasury_wallet.key() == global_data.treasury_wallet @ SpinXError::OwnerMismatch
    )]
    pub treasury_wallet: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool
    )]
    pub spl_escrow: Account<'info, TokenAccount>,

    /// CHECK:
    #[account(
        mut,
        seeds = [RANDOMNESS_ACCOUNT_SEED, &force],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub random: AccountInfo<'info>,
    /// CHECK:
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    
    #[account(
        mut,
        seeds = [CONFIG_ACCOUNT_SEED],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub config: Account<'info, NetworkState>,
    
    /// CHECK:` doc comment explaining why no checks through types are necessary.
    pub vrf: Program<'info, OraoVrf>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64, force: [u8; 32])]
pub struct ResultCoinflip<'info> {

    #[account(
        mut,
        seeds = [COINFLIP_SEED.as_bytes(), pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub coinflip_pool: Account<'info, CoinflipPool>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool
    )]
    pub spl_escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub spinx_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool.creator_player
    )]
    pub creator_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool.joiner_player
    )]
    pub joiner_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: Treasury
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    /// CHECK: Randomness
    #[account(
        mut,
        seeds = [RANDOMNESS_ACCOUNT_SEED, &force],
        bump,
        seeds::program = orao_solana_vrf::ID,
        constraint = coinflip_pool.force == force @  SpinXError::OwnerMismatch
    )]
    pub random: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [CONFIG_ACCOUNT_SEED.as_ref()],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub config: Account<'info, NetworkState>,
    pub vrf: Program<'info, OraoVrf>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CloseCoinflip<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [COINFLIP_SEED.as_bytes(), pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub coinflip_pool: Account<'info, CoinflipPool>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool
    )]
    pub spl_escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub spinx_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = spinx_mint,
        associated_token::authority = coinflip_pool.creator_player
    )]
    pub creator_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK:` doc comment explaining why no checks through types are necessary.
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
