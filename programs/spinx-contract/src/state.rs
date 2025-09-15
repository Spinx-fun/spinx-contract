use std::mem::size_of;

pub mod error;

use error::*;
use anchor_lang::prelude::*;
use orao_solana_vrf::state::RandomnessAccountData;

#[account]
pub struct PlayerState {
    pub player: Pubkey,
    pub force: [u8; 32],
    pub rounds: u64,
}

impl PlayerState {
    pub const SIZE: usize = std::mem::size_of::<Self>();

    /// Creates a new state for the `player`.
    pub fn new(player: Pubkey) -> Self {
        Self {
            player,
            force: Default::default(),
            rounds: Default::default(),
        }
    }

    /// Asserts that the player is able to play.
    ///
    /// Returns `Ok` on success.
    pub fn assert_can_play(&self, prev_round_acc: &AccountInfo) -> Result<()> {
        if self.rounds == 0 {
            return Ok(());
        }
        let rand_acc = crate::misc::get_account_data(prev_round_acc)?;
        match current_state(&rand_acc) {
            CurrentState::Head => Ok(()),
            CurrentState::Tail => Ok(()),
            CurrentState::Waiting => Err(SpinXError::ChallengeNotTaken),
        }
    }
}

/// Last round outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurrentState {
    Head,
    Tail,
    Waiting,
}

/// Derives last round outcome.
pub fn current_state(randomness: &RandomnessAccountData) -> CurrentState {
    if let Some(randomness) = randomness.fulfilled_randomness() {
        if is_head(randomness) {
            CurrentState::Head
        } else {
            CurrentState::Tail
        }
    } else {
        CurrentState::Waiting
    }
}

/// Decides whether coin is head or tail.
fn is_head(randomness: &[u8; 64]) -> bool {
    // use only first 8 bytes for simplicyty
    let value = randomness[0..size_of::<u64>()].try_into().unwrap();
    u64::from_le_bytes(value) % 2 == 0
}
