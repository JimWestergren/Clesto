/* START OF FILE constants.js */

/**
 * @fileoverview Constants used throughout the Clesto game application.
 */

// --- Debug Flag ---
/**
 * Set to true to enable debug logging and the debug panel.
 * Set to false to disable debug features for production.
 * @type {boolean}
 */
const DEBUG_MODE = false; // SET TO true TO SHOW DEBUG PANEL, false TO HIDE

// --- Game Board Dimensions ---
/** @type {number} Number of rows on the board. */
const ROWS = 9;
/** @type {number} Number of columns on the board. */
const COLS = 7;
/** @type {number} Total number of squares on the board (ROWS * COLS). */
const SQUARES = ROWS * COLS; // 63

// --- Piece Definitions ---
/** @type {number} Total number of unique piece types (8 ranks * 2 players). */
const NUM_PIECE_TYPES = 16;
/**
 * Mapping of player internal names.
 * @enum {string}
 */
const PLAYERS = {
    ORANGE: 'orange',
    YELLOW: 'yellow'
};
/**
 * Mapping of piece rank numbers to their display names.
 * @type {Object.<number, string>}
 */
const RANK_TO_NAME = {
    8: 'Elephant',
    7: 'Lion',
    6: 'Tiger',
    5: 'Leopard',
    4: 'Wolf',
    3: 'Dog',
    2: 'Cat',
    1: 'Rat'
};
/**
 * Mapping of piece rank numbers to their code representation for notation.
 * @type {Object.<number, string>}
 */
const RANK_TO_CODE = {
    8: '8',
    7: '7',
    6: '6',
    5: '5',
    4: '4',
    3: '3',
    2: '2',
    1: '1'
};

/**
 * Defines special abilities and emojis for each piece rank.
 * Emojis: 💧 (Swim), ↔️ (Jump H), ↕️ (Jump V), 🌱 (Attack Elephant From Land), 🐾 (Can Kill Elephant)
 * @type {Object.<number, {name: string, rank: number, swims?: boolean, attacksElephant?: boolean, jumpH?: boolean, jumpV?: boolean, emoji?: string}>}
 */
const SPECIAL_ABILITIES = {
    1: { name: 'Rat', rank: 1, swims: true, attacksElephant: true, emoji: '💧🐾🌱' }, // Can swim, Can Kill Elephant, Attack Elephant From Land
    2: { name: 'Cat', rank: 2 },
    3: { name: 'Dog', rank: 3, swims: true, emoji: '💧' }, // Can swim
    4: { name: 'Wolf', rank: 4 },
    5: { name: 'Leopard', rank: 5, jumpH: true, emoji: '↔️' }, // Can jump horizontally
    6: { name: 'Tiger', rank: 6, jumpH: true, jumpV: true, emoji: '↔️↕️' }, // Can jump horizontally and vertically
    7: { name: 'Lion', rank: 7, jumpH: true, jumpV: true, emoji: '↔️↕️' }, // Can jump horizontally and vertically
    8: { name: 'Elephant', rank: 8 } // Cannot be attacked by Rat (except special case)
};

// Mapping of rank number to rank emoji for tooltip
const RANK_EMOJI = {
    1: '1️⃣',
    2: '2️⃣',
    3: '3️⃣',
    4: '4️⃣',
    5: '5️⃣',
    6: '6️⃣',
    7: '7️⃣',
    8: '8️⃣'
};

// --- Initial Board Setup ---
/**
 * Standard starting positions for all pieces.
 * Format: { 'coords': { player: PLAYERS, rank: number } }
 * @type {Object.<string, {player: string, rank: number}>}
 */
const INITIAL_SETUP = {
    // Orange Pieces (Bottom Row Area) - Sorted Rank 8 to 1
    'a3': { player: PLAYERS.ORANGE, rank: 8 }, // Elephant
    'g1': { player: PLAYERS.ORANGE, rank: 7 }, // Lion
    'a1': { player: PLAYERS.ORANGE, rank: 6 }, // Tiger
    'e3': { player: PLAYERS.ORANGE, rank: 5 }, // Leopard
    'f2': { player: PLAYERS.ORANGE, rank: 4 }, // Wolf
    'c3': { player: PLAYERS.ORANGE, rank: 3 }, // Dog
    'b2': { player: PLAYERS.ORANGE, rank: 2 }, // Cat
    'g3': { player: PLAYERS.ORANGE, rank: 1 }, // Rat
    // Yellow Pieces (Top Row Area) - Sorted Rank 8 to 1
    'g7': { player: PLAYERS.YELLOW, rank: 8 }, // Elephant
    'a9': { player: PLAYERS.YELLOW, rank: 7 }, // Lion
    'g9': { player: PLAYERS.YELLOW, rank: 6 }, // Tiger
    'c7': { player: PLAYERS.YELLOW, rank: 5 }, // Leopard
    'b8': { player: PLAYERS.YELLOW, rank: 4 }, // Wolf
    'e7': { player: PLAYERS.YELLOW, rank: 3 }, // Dog
    'f8': { player: PLAYERS.YELLOW, rank: 2 }, // Cat
    'a7': { player: PLAYERS.YELLOW, rank: 1 }  // Rat
};

// --- Board Terrain ---
/**
 * Set of coordinates designated as water squares.
 * @type {Set<string>}
 */
const WATER_SQUARES = new Set(['b4', 'c4', 'e4', 'f4', 'b5', 'c5', 'e5', 'f5', 'b6', 'c6', 'e6', 'f6']);
/**
 * Defines trap squares near each player's den.
 * Opponent's pieces lose rank on these squares.
 * @type {{orange: Set<string>, yellow: Set<string>}}
 */
const TRAPS = {
    orange: new Set(['c9', 'd8', 'e9']), // Traps near Yellow's Den (affect Yellow pieces)
    yellow: new Set(['c1', 'd2', 'e1']) // Traps near Orange's Den (affect Orange pieces)
};
/**
 * Combined set of all trap squares on the board.
 * @type {Set<string>}
 */
const ALL_TRAP_SQUARES = new Set([...TRAPS.orange, ...TRAPS.yellow]);
/**
 * Coordinates of each player's den (winning square).
 * @type {{orange: string, yellow: string}}
 */
const DENS = {
    orange: 'd1', // Orange's Den
    yellow: 'd9' // Yellow's Den
};

// --- AI Configuration ---
/** Default search depth for the minimax AI. @type {number} */
const MINIMAX_DEPTH = 10; // Increased from 8
/** Maximum search depth allowed for the AI search. @type {number} */
const MAX_SEARCH_DEPTH = MINIMAX_DEPTH;
/** Maximum depth the quiescence search can extend beyond the main search depth. @type {number} */
const MAX_QUIESCENCE_DEPTH = 6;
/** Maximum search depth used during the opening phase (when many pieces are on board). @type {number} */
const OPENING_DEPTH_CAP = 8; // Increased from 6
/** Minimum search depth the AI will perform, regardless of dynamic calculations. @type {number} */
const MIN_FORCED_DEPTH = 3; // Added this constant (was used in triggerAIMove)

// --- AI Time Management ---
/** Approximate fraction of remaining clock time to use per move. @type {number} */
const TIME_USAGE_FACTOR = 1 / 25; // Use roughly 1/25th of remaining time
/** Minimum time in milliseconds the AI will spend on a move if time allows. @type {number} */
const MIN_TIME_PER_MOVE = 500;
/**
 * Factor used for pre-emptive time checking in Iterative Deepening.
 * If elapsed time > timeLimit * factor, stop deepening early.
 * @type {number}
 */
const TIME_PREDICTION_FACTOR = 0.9; // Stop if > 90% of time is used

// --- Transposition Table ---
/**
 * Types of entries stored in the Transposition Table.
 * @enum {number}
 */
const TT_ENTRY_TYPE = {
    EXACT: 0,       // Score is the exact value for the node
    LOWER_BOUND: 1, // Score is at least this value (alpha cutoff occurred)
    UPPER_BOUND: 2  // Score is at most this value (beta cutoff occurred / no move improved alpha)
};
/** Conceptual size limit for the Transposition Table (approx 1 million entries). @type {number} */
const TRANSPOSITION_TABLE_SIZE = 1 << 20;

// --- Bitboard Constants ---
/** Represents an empty bitboard. @type {bigint} */
const BB_EMPTY = 0n;
/** Represents a bitboard with all bits set (assuming 64 bits are sufficient for 63 squares). @type {bigint} */
const BB_ALL = 0xFFFFFFFFFFFFFFFFn;

// Piece Type Indices (0-15) matching getPieceTypeIndex logic
/** Index for Orange Rat. @type {number} */
const O_RAT_IDX = 0;
/** Index for Orange Cat. @type {number} */
const O_CAT_IDX = 1;
/** Index for Orange Dog. @type {number} */
const O_DOG_IDX = 2;
/** Index for Orange Wolf. @type {number} */
const O_WOLF_IDX = 3;
/** Index for Orange Leopard. @type {number} */
const O_LEOPARD_IDX = 4;
/** Index for Orange Tiger. @type {number} */
const O_TIGER_IDX = 5;
/** Index for Orange Lion. @type {number} */
const O_LION_IDX = 6;
/** Index for Orange Elephant. @type {number} */
const O_ELEPHANT_IDX = 7;
/** Index for Yellow Rat. @type {number} */
const Y_RAT_IDX = 8;
/** Index for Yellow Cat. @type {number} */
const Y_CAT_IDX = 9;
/** Index for Yellow Dog. @type {number} */
const Y_DOG_IDX = 10;
/** Index for Yellow Wolf. @type {number} */
const Y_WOLF_IDX = 11;
/** Index for Yellow Leopard. @type {number} */
const Y_LEOPARD_IDX = 12;
/** Index for Yellow Tiger. @type {number} */
const Y_TIGER_IDX = 13;
/** Index for Yellow Lion. @type {number} */
const Y_LION_IDX = 14;
/** Index for Yellow Elephant. @type {number} */
const Y_ELEPHANT_IDX = 15;

// Player Indices (for combined player boards)
/** Index for Orange player in combined bitboards. @type {number} */
const ORANGE_IDX = 0; // Using 0 for Orange in playerBB array
/** Index for Yellow player in combined bitboards. @type {number} */
const YELLOW_IDX = 1; // Using 1 for Yellow in playerBB array

/**
 * Indices for accessing specific bitboards within the main bitboard array.
 * @enum {number}
 */
const BB_IDX = {
    PIECE_START: 0,      // Start index for individual piece types (O_RAT_IDX)
    PIECE_END: 15,       // End index for individual piece types (Y_ELEPHANT_IDX)
    ORANGE_PIECES: 16,   // Index for the combined bitboard of all Orange pieces
    YELLOW_PIECES: 17,   // Index for the combined bitboard of all Yellow pieces
    OCCUPIED: 18,        // Index for the combined bitboard of all occupied squares
    COUNT: 19            // Total number of dynamic bitboards in the array
};

// --- Evaluation Constants ---
/** Dominant score assigned for achieving a win state. @type {number} */
const EVAL_WIN_SCORE = 150000;
/** Dominant score assigned for being in a lost state. @type {number} */
const EVAL_LOSE_SCORE = -150000;

/** Weight multiplier for the material difference component of the evaluation. @type {number} */
const EVAL_MATERIAL_MULT = 1.2;
/**
 * Base material values assigned to each piece rank.
 * @type {Object.<number, number>}
 */
const EVAL_PIECE_VALUES = { 1: 35, 2: 10, 3: 30, 4: 20, 5: 40, 6: 60, 7: 95, 8: 75 }; // Keep Lion high! Wolf increased slightly.

/** Penalty applied if a piece is on an opponent's trap AND immediately capturable by a weaker piece. @type {number} */
const EVAL_IMMEDIATE_TRAP_DOOM_PENALTY = -130000; // Almost as bad as losing

/** Penalty for opponent having an undefended piece adjacent to our den (near losing). */
const EVAL_UNANSWERED_DEN_THREAT_PENALTY = -140000; // Near EVAL_LOSE_SCORE
/** Bonus for having an undefended piece adjacent to opponent's den (near winning). */
const EVAL_SAFE_DEN_ATTACK_BONUS = 140000; // Near EVAL_WIN_SCORE

// Den Proximity Bonuses/Penalties (Base values, scaled by rank value)
/** Base bonus for being 1 step away from the opponent's den. @type {number} */
const EVAL_DEN_ADJACENT_BASE_BONUS = 500;
/** Base bonus for being 2 steps away from the opponent's den. @type {number} */
const EVAL_DEN_NEAR_BASE_BONUS = 250;
/** Base penalty for the opponent being 1 step away from our den. @type {number} */
const EVAL_OPP_DEN_ADJACENT_BASE_PENALTY = -500;
/** Base penalty for the opponent being 2 steps away from our den. @type {number} */
const EVAL_OPP_DEN_NEAR_BASE_PENALTY = -250;
/** Factor determining how much piece rank/value scales the den proximity bonus/penalty. @type {number} */
const DEN_PROXIMITY_RANK_SCALE_FACTOR = 0.5;

// Specific QSearch Bonuses (Keep high to encourage den pressure checks)
/** Bonus applied in Quiescence search if a Lion is adjacent to the opponent's den. @type {number} */
const QSEARCH_LION_ADJACENT_DEN_BONUS = 0;
/** Bonus applied in Quiescence search if a Lion is near (2 steps) the opponent's den. @type {number} */
const QSEARCH_LION_NEAR_DEN_BONUS = 0;

// Threat Multipliers
/** Bonus multiplier (applied to victim's value) for threatening an opponent piece. @type {number} */
const EVAL_THREATENING_BONUS_MULT = 1.5;
/** Base penalty multiplier (applied to threatened piece's value) if attacked by a lower or equal rank piece. @type {number} */
const EVAL_THREATENED_PENALTY_MULT = 1.5; // Significantly increased
/** Additional penalty multiplier if an attacked piece is undefended. @type {number} */
const EVAL_UNDEFENDED_THREAT_PENALTY_MULT = 0.5; // Added penalty for undefended pieces

// Positional Bonuses
/** Bonus for pieces advanced past the board's midline. @type {number} */
const EVAL_ADVANCE_BONUS = 5; // Increased
/** Bonus for pieces occupying the central columns (C, D, E). @type {number} */
const EVAL_CENTER_BONUS = 5; // Increased

// Water Control
/** Bonus per friendly Rat/Dog on a water square. @type {number} */
const EVAL_WATER_CONTROL_BONUS = 15;
/** Penalty per opponent Rat/Dog on a water square. @type {number} */
const EVAL_OPP_WATER_CONTROL_PENALTY = -15;

// Mobility Weight (Currently disabled)
/** Weight multiplier for the difference in the number of legal moves available to each player. @type {number} */
const EVAL_MOBILITY_WEIGHT = 0; // Set > 0 to enable

// Mate Score Thresholds (Derived from Win/Loss scores)
/** Score threshold above which a position is considered a likely forced mate. @type {number} */
const EVAL_MATE_SCORE_THRESHOLD = EVAL_WIN_SCORE / 1.1;
/** Score threshold below which a position is considered a likely forced loss (being mated). @type {number} */
const EVAL_MATED_SCORE_THRESHOLD = EVAL_LOSE_SCORE / 1.1;

// Evaluation Constants for Hungry State
/** Penalty multiplier based on the value of the player's own hungry piece. */
const EVAL_OWN_HUNGRY_VALUE_PENALTY_MULT = 52; // Increase penalty significantly based on value
/** Bonus multiplier based on the value of the opponent's hungry piece. */
const EVAL_OPP_HUNGRY_VALUE_BONUS_MULT = 0.25; // Bonus for making opponent pieces hungry (value-based)


/** Bonus for making more than one opponent piece hungry. @type {number} */
/* const EVAL_MULTI_HUNGRY_BONUS = 150; // Increased */
/** Penalty for having only one of your own pieces hungry. @type {number} */
/* const EVAL_SINGLE_HUNGRY_PENALTY = -125; // Increased penalty */


// --- Search Enhancement Constants ---

// Null Move Pruning (NMP)
/** Depth reduction applied during the null move search. @type {number} */
const NMP_REDUCTION = 3;
/** Minimum remaining depth required to consider applying NMP. @type {number} */
const NMP_MIN_DEPTH = 3;

// Late Move Reductions (LMR)
/** Minimum remaining depth required to consider applying LMR. @type {number} */
const LMR_MIN_DEPTH = 3;
/** Apply LMR after this many moves have been searched at a node. @type {number} */
const LMR_MOVE_COUNT_THRESHOLD = 4;
/** Base depth reduction applied by LMR. @type {number} */
const LMR_BASE_REDUCTION = 1;

// Futility Pruning (FP)
/** Maximum *remaining* depth at which to apply futility pruning. @type {number} */
const FP_MAX_DEPTH = 2;
/** Margin added to static eval (scaled by depth). Prune if staticEval + margin <= alpha. @type {number} */
const FP_MARGIN_PER_DEPTH = 40; // Approx value of Leopard

// Move Ordering Bonuses
/** Score bonus assigned to killer moves during move ordering. @type {number} */
const KILLER_MOVE_BONUS = 17500;
/** Maximum value allowed for history heuristic scores. @type {number} */
const HISTORY_MAX = 10000;

// MVV-LVA Scoring Constants
/** Base score added to all captures to prioritize them over quiet moves. @type {number} */
const MVV_LVA_BASE_SCORE = 10000;
/** Multiplier applied to the victim's piece value in MVV-LVA calculation. @type {number} */
const VICTIM_MULTIPLIER = 10;

// --- Clock Constants ---
/** Initial time allocated to each player in seconds. @type {number} */
const INITIAL_TIME_SECONDS = 5 * 60; // 10 minutes
/** Time increment in seconds added to a player's clock after making a move. @type {number} */
const INCREMENT_SECONDS = 2; // 2 seconds bonus

// --- Debug Tracing ---
/** Specific move to enable detailed tracing for during AI search (if enableTracing=true in ai.js). @type {{from: string, to: string}} */
const TRACE_MOVE = { from: 'g7', to: 'f7' };

// --- Export (if using modules) ---
// If using ES Modules, you would add:
// export { ROWS, COLS, PLAYERS, ... };
// If using CommonJS (Node.js), you would add:
// module.exports = { ROWS, COLS, PLAYERS, ... };
// For a simple browser script, these are just global constants.