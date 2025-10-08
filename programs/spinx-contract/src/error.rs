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

    #[msg("Invalid Creator Address")]
    InvalidCreator,

    #[msg("Invalid Claim Status")]
    InvalidClaimStatus,

    #[msg("Invalid Pool Status")]
    InvalidPoolStatus,

    #[msg("Invalid force")]
    InvalidForce,

    #[msg("Already Claimed Game")]
    AlreadyClaimed,

    #[msg("Already Drawn Game")]
    AlreadyDrawn,

    #[msg("Already Joined Game")]
    AlreadyJoined,

    #[msg("The Account is Not Winner")]
    NotWinner,

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

    #[msg("Amount is too small")]
    AmountTooSmall,
    
    // New errors for VRF integration
    #[msg("Challenge already taken")]
    ChallengeTaken,

    #[msg("Challenge not taken")]
    ChallengeNotTaken,

    #[msg("Challenge already completed")]
    ChallengeCompleted,

    #[msg("Challenge already cancelled")]
    ChallengeCancelled,

    #[msg("Not the challenge creator")]
    NotChallengeCreator,

    #[msg("Not the treasury authority")]
    NotTreasuryAuthority,

    #[msg("Invalid VRF result")]
    InvalidVRFResult,

    #[msg("Insufficient funds")]
    InsufficientFunds,

    #[msg("Randomness is still being fulfilled")]
    StillProcessing
}