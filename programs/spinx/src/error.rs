use anchor_lang::prelude::*;

#[error_code]
pub enum SpinXError {
    
    // 0x0 ~ 0x13 - 0 ~ 19
    // Please refer this https://github.com/solana-labs/solana-program-library/blob/master/token/program/src/error.rs

    // 0x64 ~ 0x1388 - 100 ~ 5000
    // Please refer this https://github.com/project-serum/anchor/blob/master/lang/src/error.rs

    // Here are the error messages from  0x1770 ~ 
    // 0x1770

    #[msg("Invalid Admin Address")]
    InvalidAdmin,

    #[msg("Already Claimed Game")]
    AlreadyClaimed,

    #[msg("Already Drawn Game")]
    AlreadyDrawn,

    #[msg("The Account is Not Winner")]
    NotWinner,

    #[msg("The Account is Not Referrer")]
    NotReferrer,

    #[msg("Token not allowed")]
    TokenNotAllowed,
    
    #[msg("Owner mismatch")]
    OwnerMismatch,
    
    #[msg("Invalid Bet Amount")]
    InvalidAmount,
    
    #[msg("Invalid Joiner")]
    InvalidJoiner,
    
    #[msg("Invalid Bet Number")]
    InvalidNumber,
}