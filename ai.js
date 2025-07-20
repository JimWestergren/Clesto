/**
 * @fileoverview AI logic for the Clesto game.
 * Implements a Negamax search algorithm with alpha-beta pruning, transposition tables,
 * iterative deepening, and various heuristics (MVV/LVA, Killers, History) for move ordering.
 * Includes quiescence search, null move pruning, late move reductions, and futility pruning.
 * Contains the board evaluation function and AI time management logic.
 * Relies heavily on bitboard representations managed by other modules.
 */

// --- AI State Variables ---

/** Stores killer moves [ply][0 or 1] -> move object { from, to, pieceTypeIndex }. Initialized by initializeAISearchState. @type {Array<Array<object|null>>} */
let killerMoves = [];

/**
 * Stores history heuristic scores [pieceTypeIndex][toSquareIndex] -> score.
 * Higher scores indicate moves that have caused cutoffs more often.
 * Initialized by initializeAISearchState.
 * @type {Array<Array<number>>}
 */
let historyHeuristic = [];

/** Dynamic time limit per AI move in milliseconds. Set in triggerAIMove. @type {number} */
let timeLimit = 0;
/** Counter for the number of nodes visited during the AI search. Reset by initializeAISearchState. @type {number} */
let nodeCount = 0;
/** Timestamp marking the start of the current AI search. Set by initializeAISearchState. @type {number} */
let searchStartTime = 0;
/** Flag to indicate if the current AI search should be cancelled (e.g., due to time limit). Reset by initializeAISearchState. @type {boolean} */
let searchCancelled = false;
/** Global flag to enable/disable detailed AI trace logging. @type {boolean} */
let enableTracing = false; // Set true to trace TRACE_MOVE or all moves


// --- AI Initialization ---

/**
 * Initializes or resets the state variables used during an AI search.
 * Includes node count, cancellation flag, start time, killer moves table,
 * and the history heuristic table.
 * Should be called before starting a new search (e.g., in triggerAIMove).
 * Depends on: MAX_SEARCH_DEPTH, MAX_QUIESCENCE_DEPTH, MINIMAX_DEPTH (constants.js),
 *             NUM_PIECE_TYPES, SQUARES (constants.js).
 */
function initializeAISearchState() {
    nodeCount = 0;
    searchStartTime = performance.now();
    searchCancelled = false; // Reset the flag

    // Initialize killer moves table (size based on max possible ply)
    const maxPly = (MAX_SEARCH_DEPTH || MINIMAX_DEPTH || 6) + (MAX_QUIESCENCE_DEPTH || 4) + 5; // Add buffer
    killerMoves = Array(maxPly).fill(null).map(() => [null, null]); // Array of pairs

    // Initialize history heuristic table (NUM_PIECE_TYPES x SQUARES)
    historyHeuristic = Array(NUM_PIECE_TYPES).fill(null).map(() => Array(SQUARES).fill(0));
}


// --- Search Heuristics & Move Ordering ---

/**
 * Adds a move to the killer moves table for a given ply depth.
 * Stores up to two killer moves per ply. Promotes the new move to the first slot.
 * Avoids adding duplicates within the same ply.
 * Depends on: killerMoves global array.
 *
 * @param {number} ply - The search depth (ply) at which the cutoff occurred.
 * @param {object} move - The move object { from, to, pieceTypeIndex } that caused the cutoff.
 */
function addKillerMove(ply, move) {
    // Basic validation
    if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number' || ply < 0 || ply >= killerMoves.length) {
        // console.warn(`addKillerMove: Invalid ply (${ply}) or move.`, move);
        return;
    }

    const killer1 = killerMoves[ply][0];
    const killer2 = killerMoves[ply][1];

    // Check if move is already stored (compare relevant parts)
    const isAlreadyKiller1 = killer1 && killer1.from === move.from && killer1.to === move.to && killer1.pieceTypeIndex === move.pieceTypeIndex;
    const isAlreadyKiller2 = killer2 && killer2.from === move.from && killer2.to === move.to && killer2.pieceTypeIndex === move.pieceTypeIndex;

    if (isAlreadyKiller1) {
        return; // Move already in first slot, do nothing
    }
    if (isAlreadyKiller2) {
        // Promote killer2 to killer1
        killerMoves[ply][0] = killer2;
        killerMoves[ply][1] = killer1; // Old killer1 becomes killer2
        return;
    }

    // New killer move: shift existing killers and add the new one to the first slot
    killerMoves[ply][1] = killer1; // Old slot 0 moves to slot 1 (might be null)
    killerMoves[ply][0] = move;    // New move goes into slot 0
}

/**
 * Updates the history heuristic score for a given piece type moving to a specific square index.
 * Increases the score based on the bonus (typically related to search depth),
 * capping it at HISTORY_MAX.
 * Depends on: historyHeuristic global array, NUM_PIECE_TYPES, SQUARES, HISTORY_MAX (constants.js).
 *
 * @param {number} pieceTypeIndex - The index (0-15) of the piece type that moved.
 * @param {number} toSquareIndex - The destination square index (0-62).
 * @param {number} depthBonus - The bonus value to add (e.g., depth * depth). Must be positive.
 */
function updateHistoryScore(pieceTypeIndex, toSquareIndex, depthBonus) {
    if (depthBonus <= 0) return; // Only update for positive bonuses

    // Validate indices
    if (pieceTypeIndex < 0 || pieceTypeIndex >= NUM_PIECE_TYPES || toSquareIndex < 0 || toSquareIndex >= SQUARES) {
        // console.warn(`updateHistoryScore: Invalid pieceTypeIndex (${pieceTypeIndex}) or toSquareIndex (${toSquareIndex}).`);
        return;
    }

    // Ensure the array structure exists (should be guaranteed by initializeAISearchState)
    if (!historyHeuristic[pieceTypeIndex]) {
        console.error("History Heuristic array missing for piece type:", pieceTypeIndex);
        // Attempt recovery (though this indicates an initialization problem)
        historyHeuristic[pieceTypeIndex] = Array(SQUARES).fill(0);
    }
     if (typeof historyHeuristic[pieceTypeIndex][toSquareIndex] !== 'number') {
        // console.warn(`History Heuristic score at [${pieceTypeIndex}][${toSquareIndex}] is not a number. Resetting to 0.`);
        historyHeuristic[pieceTypeIndex][toSquareIndex] = 0;
     }

    // Calculate and update score
    let currentScore = historyHeuristic[pieceTypeIndex][toSquareIndex];
    currentScore += depthBonus;

    // Cap the score
    historyHeuristic[pieceTypeIndex][toSquareIndex] = Math.min(currentScore, HISTORY_MAX);
}

/**
 * Calculates the Most Valuable Victim - Least Valuable Attacker (MVV-LVA) score for a capture move.
 * Used for prioritizing capture moves during move ordering.
 * Higher score means capturing a more valuable piece with a less valuable attacker.
 * Adds a large base score to ensure captures are prioritized over quiet moves.
 * Needs access to the board state (bitboards) to determine victim and attacker ranks.
 * Depends on: getPieceData (gameState.js), EVAL_PIECE_VALUES, MVV_LVA_BASE_SCORE, VICTIM_MULTIPLIER (constants.js).
 *
 * @param {object} move - The move object { from, to, pieceTypeIndex }.
 * @param {bigint[]} bitboards - The current bitboard state.
 * @returns {number} The MVV-LVA score for the capture, or 0 if it's not a capture or data is missing.
 */
function getMvvLvaScoreBB(move, bitboards) {
    if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') return 0;

    // Get victim piece data from the 'to' square using bitboards
    const victimData = getPieceData(move.to, bitboards);
    if (!victimData) return 0; // Not a capture

    // Attacker rank can be derived from the move's pieceTypeIndex
    const attackerRank = (move.pieceTypeIndex % 8) + 1;
    if (attackerRank < 1 || attackerRank > 8) {
         console.warn(`getMvvLvaScoreBB: Invalid attacker rank derived from index ${move.pieceTypeIndex}`);
         return 0; // Invalid attacker
    }

    const victimValue = EVAL_PIECE_VALUES[victimData.rank] || 10; // Use default if rank invalid
    const attackerValue = EVAL_PIECE_VALUES[attackerRank] || 100; // Use default if rank invalid

    // Calculate score: Base + (Victim Value * Multiplier) - Attacker Value
    return MVV_LVA_BASE_SCORE + (victimValue * VICTIM_MULTIPLIER) - attackerValue;
}


/**
 * Generates and orders valid moves for the current node in the bitboard search.
 * Prioritizes moves based on: TT Hint > Captures (MVV/LVA) > Killers > History > Quiet.
 * Depends on: getMvvLvaScoreBB, killerMoves, historyHeuristic globals, getPieceData (gameState.js),
 *             coordToBitIndex (bitboardUtils.js), KILLER_MOVE_BONUS, HISTORY_MAX (constants.js).
 *
 * @param {bigint[]} bitboards - The current bitboard state.
 * @param {object | null} ttBestMove - The best move suggested by TT { from, to, pieceTypeIndex }.
 * @param {number} ply - Current search depth (ply) for killer/history lookups.
 * @param {Array<object>} movesToConsider - Pre-generated list of pseudo-legal moves { from, to, pieceTypeIndex }.
 * @param {string} player - The player whose moves are being ordered.
 * @returns {Array<object>} Sorted array of move objects.
 */
function getOrderedMovesBB(bitboards, ttBestMove, ply, movesToConsider, player) {
    if (!movesToConsider || movesToConsider.length === 0) {
        return [];
    }

    const scoredMoves = []; // Store as { move, score } pairs

    for (const move of movesToConsider) {
        if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') continue; // Skip invalid move objects

        let score = 0; // Default score for quiet moves

        // 1. TT Move Hint (Highest Priority)
        if (ttBestMove && move.from === ttBestMove.from && move.to === ttBestMove.to && move.pieceTypeIndex === ttBestMove.pieceTypeIndex) {
            score = 200000; // Assign highest score
        } else {
            // 2. Captures (MVV/LVA) - Calculate score using the BB version
            const mvvLvaScore = getMvvLvaScoreBB(move, bitboards);
            if (mvvLvaScore > 0) {
                // Ensure MVV/LVA scores are high enough to be prioritized
                // MVV_LVA_BASE_SCORE is already 10000
                score = mvvLvaScore;
            } else {
                // Only consider Killers and History for non-capture moves
                let isKiller = false;
                // 3. Killer Moves
                if (ply >= 0 && ply < killerMoves.length) {
                    const killer1 = killerMoves[ply][0];
                    const killer2 = killerMoves[ply][1];
                    if (killer1 && move.from === killer1.from && move.to === killer1.to && move.pieceTypeIndex === killer1.pieceTypeIndex) {
                        score = KILLER_MOVE_BONUS; // e.g., 7500
                        isKiller = true;
                    } else if (killer2 && move.from === killer2.from && move.to === killer2.to && move.pieceTypeIndex === killer2.pieceTypeIndex) {
                        score = KILLER_MOVE_BONUS - 10; // Slightly lower bonus
                        isKiller = true;
                    }
                }

                // 4. History Heuristic (Only if not TT, Capture, or Killer)
                if (!isKiller) {
                    const toSquareIndex = coordToBitIndex(move.to);
                    if (move.pieceTypeIndex >= 0 && move.pieceTypeIndex < historyHeuristic.length &&
                        toSquareIndex !== -1 && historyHeuristic[move.pieceTypeIndex]?.[toSquareIndex])
                    {
                        // History scores max out at HISTORY_MAX (e.g., 10000)
                        // Ensure history score doesn't accidentally overwrite a killer score if logic changes
                        score = historyHeuristic[move.pieceTypeIndex][toSquareIndex];
                    }
                    // Quiet moves with no history score remain score = 0
                }
            }
        }
        scoredMoves.push({ move, score });
    } // End loop through moves

    // Sort moves in descending order of score
    scoredMoves.sort((a, b) => b.score - a.score);

    // Return just the move objects in the new order
    return scoredMoves.map(item => item.move);
}


// --- Evaluation ---

/**
 * [PLACEHOLDER] Generates attack maps for both players.
 * This is a simplified placeholder. A real implementation would calculate
 * all squares attacked by each player's pieces based on their move capabilities.
 * This function is needed by the current `evaluateBoardBB`.
 *
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @returns {{attacked: {orange: Set<string>, yellow: Set<string>}, moves: {orange: Array<object>, yellow: Array<object>}}}
 *          Object containing sets of attacked coordinates and arrays of valid moves for each player.
 */
function generateAttackMaps(bitboards) {
    // console.warn("generateAttackMaps is a placeholder - using getAllValidMovesBB for basic info.");
    const attacked = { [PLAYERS.ORANGE]: new Set(), [PLAYERS.YELLOW]: new Set() };
    const moves = { [PLAYERS.ORANGE]: [], [PLAYERS.YELLOW]: [] };

    try {
        moves[PLAYERS.ORANGE] = getAllValidMovesBB(bitboards, PLAYERS.ORANGE, true); // Get pseudo-legal moves
        moves[PLAYERS.YELLOW] = getAllValidMovesBB(bitboards, PLAYERS.YELLOW, true);

        // Populate attacked sets based on the 'to' squares of generated moves
        moves[PLAYERS.ORANGE].forEach(move => { if (move && move.to) attacked[PLAYERS.ORANGE].add(move.to); });
        moves[PLAYERS.YELLOW].forEach(move => { if (move && move.to) attacked[PLAYERS.YELLOW].add(move.to); });

    } catch (e) {
        console.error("Error during placeholder generateAttackMaps:", e);
        // Return empty structure on error
        return { attacked: { orange: new Set(), yellow: new Set() }, moves: { orange: [], yellow: [] }};
    }

    return { attacked, moves };
}


/**
 * Static Evaluation Function using Bitboards (V11.8 - Internal Clamping).
 * Evaluates based on Material, Den Proximity (with clamping after large bonuses/penalties),
 * positional masks, basic safety checks, and value-based hungry penalties.
 * Includes checks for non-finite scores at intermediate steps.
 * Relies on `generateAttackMapsBB` for accurate threat detection.
 * Depends on: BB_IDX, EVAL_*, PLAYERS, DENS, TRAPS (constants.js),
 *             popcount, getBit, lsbIndex, bitIndexToCoord, coordToBitIndex, allTrapsBB, waterBB (bitboardUtils.js),
 *             generateAttackMapsBB (bitboardUtils.js),
 *             getPieceData (gameState.js), getRowCol (utils.js), getAllValidMovesBB (gameLogic.js),
 *             isValidMoveBB,
 *             gameState (for hungryBB).
 *             Global bitboard state from bitboardUtils.js (centerColsBB, orangeAdvanceBB, etc.).
 *
 * @param {bigint[]} bitboards - The bitboard array state.
 * @param {string} playerForMax - The player considered "maximizing" (the perspective for the returned score).
 * @returns {number} A numerical score. Higher is better for playerForMax. Clamped & Finite.
 */
function evaluateBoardBB(bitboards, playerForMax) {
    // --- Evaluation Terms ---
    // (+) Material
    // (+) Center Control
    // (+) Advancement
    // (+) Den Proximity (Non-hungry pieces near opponent den)
    // (+) Safe Den Attack: HUGE bonus if piece adjacent to opponent den AND cannot be captured.
    // (+) Threatening Opponent Pieces
    // (+) Opponent Hungry (Bonus based on VALUE of opponent's hungry pieces)
    // (+) Water Control
    // (-) Threatened Pieces (includes undefended penalty)
    // (-) Opponent Water Control
    // (-) Own Den Proximity (Opponent pieces near own den)
    // (-) Unanswered Den Threat: HUGE penalty if opponent adjacent to own den AND cannot be captured.
    // (-) Own Hungry Pieces (Penalty based on VALUE of own hungry pieces)
    // (-) Immediate Losing Capture Penalty
    // (-) Immediate Trap Doom Penalty

    let score = 0;
    const fnName = "evaluateBoardBB";

    // --- Basic Validation ---
    if (!bitboards || bitboards.length !== BB_IDX.COUNT || (playerForMax !== PLAYERS.ORANGE && playerForMax !== PLAYERS.YELLOW)) {
        console.error(`[${fnName} Error] Invalid bitboards array or playerForMax provided.`);
        return EVAL_LOSE_SCORE + 10; // Return a penalty score
    }

    const opponent = playerForMax === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const maxDenCoord = DENS[playerForMax]; // Player's own den
    const minDenCoord = DENS[opponent]; // Opponent's den
    const orangeTrapBBForEval = orangeTrapBB; // Use specific variables for clarity
    const yellowTrapBBForEval = yellowTrapBB;


    // Safely access hungryBB, defaulting to empty if undefined/null
    const maxHungryBB = gameState?.hungryBB?.[playerForMax] ?? BB_EMPTY;
    const minHungryBB = gameState?.hungryBB?.[opponent] ?? BB_EMPTY;


    // --- Generate Attack Maps ---
    let playerAttackMapBB = BB_EMPTY;
    let opponentAttackMapBB = BB_EMPTY;
    try {
        playerAttackMapBB = generateAttackMapsBB(bitboards, playerForMax);
        opponentAttackMapBB = generateAttackMapsBB(bitboards, opponent);
    } catch (e) {
        console.error(`[${fnName} Error] Generating attack maps:`, e);
    }

    // --- Collect Piece Data & Check Immediate Den Wins ---
    let maxMaterial = 0, minMaterial = 0;
    let maxPieceCountTotal = 0, minPieceCountTotal = 0;
    const piecesData = { [playerForMax]: {}, [opponent]: {} };

    try {
        const maxDenIdx = coordToBitIndex(maxDenCoord);
        const minDenIdx = coordToBitIndex(minDenCoord);

        if (minDenIdx === -1 || maxDenIdx === -1) {
            console.error(`[${fnName} Error] Invalid Den coordinates.`);
            return 0;
        }

        for (let pieceTypeIndex = BB_IDX.PIECE_START; pieceTypeIndex <= BB_IDX.PIECE_END; pieceTypeIndex++) {
            const rank = (pieceTypeIndex % 8) + 1;
            const player = pieceTypeIndex < 8 ? PLAYERS.ORANGE : PLAYERS.YELLOW;
            const pieceValue = EVAL_PIECE_VALUES[rank] || 0;
            let tempBB = bitboards[pieceTypeIndex];

            while (tempBB !== BB_EMPTY) {
                const lsb = lsbIndex(tempBB);
                if (lsb === -1) break;
                const isHungry = (player === playerForMax) ? (getBit(maxHungryBB, lsb) !== 0n) : (getBit(minHungryBB, lsb) !== 0n);
                if (lsb === minDenIdx && player === playerForMax && !isHungry) { return EVAL_WIN_SCORE; }
                if (lsb === maxDenIdx && player === opponent && !isHungry) { return EVAL_LOSE_SCORE; }
                const coords = bitIndexToCoord(lsb);
                if (!coords) { tempBB = clearBit(tempBB, lsb); continue; }
                const rc = getRowCol(coords);
                if (!rc) { tempBB = clearBit(tempBB, lsb); continue; }
                piecesData[player][coords] = { rank: rank, rc: rc, isHungry: isHungry, index: lsb };
                if (player === playerForMax) { maxPieceCountTotal++; maxMaterial += pieceValue; }
                else { minPieceCountTotal++; minMaterial += pieceValue; }
                tempBB = clearBit(tempBB, lsb);
            }
        }
    } catch (e) { console.error(`[${fnName} Error] During piece data collection:`, e); return 0; }

    // --- Check Elimination Win/Loss ---
    if (minPieceCountTotal === 0) return EVAL_WIN_SCORE;
    if (maxPieceCountTotal === 0) return EVAL_LOSE_SCORE;

    // --- Apply Material Score ---
    score += (maxMaterial - minMaterial) * EVAL_MATERIAL_MULT;
    score = Math.max(EVAL_LOSE_SCORE / 2, Math.min(EVAL_WIN_SCORE / 2, score));
    if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Material.`); score = 0; }


    // --- Evaluate Threats/Safety & Trap Doom ---
    try {
        let totalThreatPenalty = 0;
        let totalAttackingBonus = 0;

        for (const myCoords in piecesData[playerForMax]) {
             if (!Object.prototype.hasOwnProperty.call(piecesData[playerForMax], myCoords)) continue;
             const myItem = piecesData[playerForMax][myCoords];
             if (!myItem || !myItem.rank || !myItem.rc || typeof myItem.index === 'undefined') continue;
             const myRank = myItem.rank;
             const myValue = EVAL_PIECE_VALUES[myRank] || 0;
             const myIndex = myItem.index;
             const isAttacked = getBit(opponentAttackMapBB, myIndex) !== 0n;

             if (isAttacked) {
                 let isLosingCaptureImminent = false;
                 let isDoomedOnTrap = false;
                 const relevantTrapBB = playerForMax === PLAYERS.ORANGE ? yellowTrapBBForEval : orangeTrapBBForEval;
                 const isOnRelevantTrap = getBit(relevantTrapBB, myIndex) !== 0n;

                 let opponentValidMoves = null;
                 const getOpponentMoves = () => {
                     if (opponentValidMoves === null) {
                         try { opponentValidMoves = getAllValidMovesBB(bitboards, opponent, true); }
                         catch (e) { console.error(`[${fnName}] Error getting opponent moves:`, e); opponentValidMoves = []; }
                     }
                     return opponentValidMoves;
                 };

                 // A. Check for immediate *losing* captures
                 for (const oppMove of getOpponentMoves()) {
                     if (oppMove.to === myCoords) {
                         const attackerRank = (oppMove.pieceTypeIndex % 8) + 1;
                         const oppFromIdx = coordToBitIndex(oppMove.from);
                         if (oppFromIdx !== -1) {
                             const captureValidation = isValidMoveBB(oppFromIdx, myIndex, oppMove.pieceTypeIndex, opponent, bitboards);
                             if (captureValidation.valid) {
                                 const isRatVsElephantValidAttack = (attackerRank === 1 && myRank === 8);
                                 const isStandardLosingCapture = (!isRatVsElephantValidAttack && (attackerRank >= myRank || (attackerRank === 8 && myRank === 1)));
                                 if (isStandardLosingCapture || isRatVsElephantValidAttack) {
                                     const penaltyMultiplier = 1.8; // Standard immediate loss penalty
                                     score -= myValue * penaltyMultiplier;
                                     isLosingCaptureImminent = true;
                                     break;
                                 }
                             }
                         }
                     }
                 }

                 // B. Check for immediate trap doom
                 if (!isLosingCaptureImminent && isOnRelevantTrap) {
                      for (const oppMove of getOpponentMoves()) {
                          if (oppMove.to === myCoords) {
                              const oppFromIdx = coordToBitIndex(oppMove.from);
                              if (oppFromIdx !== -1) {
                                  const trapCaptureValidation = isValidMoveBB(oppFromIdx, myIndex, oppMove.pieceTypeIndex, opponent, bitboards);
                                  if (trapCaptureValidation.valid) {
                                       score += EVAL_IMMEDIATE_TRAP_DOOM_PENALTY;
                                       score = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, score)); // Clamp
                                       if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Trap Doom Penalty.`); score = EVAL_LOSE_SCORE;}
                                       isDoomedOnTrap = true;
                                       break;
                                  }
                              }
                          }
                      }
                 }

                 // C. Apply standard threat penalties if not immediately losing/doomed
                 if (!isLosingCaptureImminent && !isDoomedOnTrap) {
                     totalThreatPenalty += EVAL_THREATENED_PENALTY_MULT * myValue;
                     const isDefended = getBit(playerAttackMapBB, myIndex) !== 0n;
                     if (!isDefended) {
                         totalThreatPenalty += EVAL_UNDEFENDED_THREAT_PENALTY_MULT * myValue;
                     }
                 }
             } // End if (isAttacked)
        } // End loop through playerForMax pieces

        score -= totalThreatPenalty;
        score = Math.max(EVAL_LOSE_SCORE / 1.5, Math.min(EVAL_WIN_SCORE / 1.5, score));
        if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Threat Penalty.`); score = 0; }

        // Attacks made by playerForMax: Bonus for threatening opponent pieces
        const opponentPiecesBB = bitboards[opponent === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES];
        let threatenedOpponentBB = playerAttackMapBB & opponentPiecesBB;
        while (threatenedOpponentBB !== BB_EMPTY) {
             const lsb = lsbIndex(threatenedOpponentBB);
             if (lsb === -1) break;
             const targetCoords = bitIndexToCoord(lsb);
             if (targetCoords) {
                 const targetPieceData = piecesData[opponent]?.[targetCoords];
                 if (targetPieceData && targetPieceData.rank) {
                     totalAttackingBonus += EVAL_THREATENING_BONUS_MULT * (EVAL_PIECE_VALUES[targetPieceData.rank] || 0);
                 }
             }
             threatenedOpponentBB = clearBit(threatenedOpponentBB, lsb);
        }
        score += totalAttackingBonus;
        score = Math.max(EVAL_LOSE_SCORE / 1.5, Math.min(EVAL_WIN_SCORE / 1.5, score));
        if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Attacking Bonus.`); score = 0; }

    } catch (e) { console.error(`[${fnName} Error] During threat/trap check:`, e); }


    // --- Evaluate Positional Factors (Center, Advancement, Den Proximity) ---
    try {
        const maxPlayerBB = bitboards[playerForMax === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES];
        const playerAdvanceBB = playerForMax === PLAYERS.ORANGE ? orangeAdvanceBB : yellowAdvanceBB;

        score += popcount(maxPlayerBB & centerColsBB) * EVAL_CENTER_BONUS;
        score += popcount(maxPlayerBB & playerAdvanceBB) * EVAL_ADVANCE_BONUS;

        const minDenRC = getRowCol(minDenCoord);
        const maxDenRC = getRowCol(maxDenCoord);

        if (minDenRC) {
             for (const coords in piecesData[playerForMax]) {
                 if (!Object.prototype.hasOwnProperty.call(piecesData[playerForMax], coords)) continue;
                 const item = piecesData[playerForMax][coords];
                 if (!item || !item.rank || !item.rc || !item.hasOwnProperty('isHungry') || typeof item.index === 'undefined') continue;
                 const pieceValue = EVAL_PIECE_VALUES[item.rank] || 0;
                 const pieceIndex = item.index;
                 const dist = Math.abs(item.rc.row - minDenRC.row) + Math.abs(item.rc.col - minDenRC.col);

                 if (!item.isHungry) {
                      if (dist === 1) {
                           const isSafe = getBit(opponentAttackMapBB, pieceIndex) === 0n;
                           if (isSafe) {
                               score += EVAL_SAFE_DEN_ATTACK_BONUS;
                               score = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, score)); // Clamp
                               if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Safe Den Bonus.`); score = EVAL_WIN_SCORE / 2;}
                           } else {
                               score += EVAL_DEN_ADJACENT_BASE_BONUS * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                           }
                      } else if (dist === 2) {
                           score += EVAL_DEN_NEAR_BASE_BONUS * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                      }
                 }
             }
        }

        if (maxDenRC) {
             for (const coords in piecesData[opponent]) {
                  if (!Object.prototype.hasOwnProperty.call(piecesData[opponent], coords)) continue;
                  const item = piecesData[opponent][coords];
                  if (!item || !item.rank || !item.rc || !item.hasOwnProperty('isHungry') || typeof item.index === 'undefined') continue;
                  const pieceValue = EVAL_PIECE_VALUES[item.rank] || 0;
                  const pieceIndex = item.index;
                  const dist = Math.abs(item.rc.row - maxDenRC.row) + Math.abs(item.rc.col - maxDenRC.col);

                  if (dist === 1) {
                      const isThreatUnanswered = getBit(playerAttackMapBB, pieceIndex) === 0n;
                      if (isThreatUnanswered) {
                           score += EVAL_UNANSWERED_DEN_THREAT_PENALTY;
                           score = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, score)); // Clamp
                           if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Unanswered Den Penalty.`); score = EVAL_LOSE_SCORE / 2;}
                      } else {
                           score += EVAL_OPP_DEN_ADJACENT_BASE_PENALTY * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                      }
                  } else if (dist === 2) {
                      score += EVAL_OPP_DEN_NEAR_BASE_PENALTY * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                  }
             }
        }
        score = Math.max(EVAL_LOSE_SCORE / 1.5, Math.min(EVAL_WIN_SCORE / 1.5, score));
        if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Positional.`); score = 0; }

    } catch (e) { console.error(`[${fnName} Error] During positional check:`, e); }


    // --- Evaluate Water Control ---
    try {
        const friendlyRatIdx = playerForMax === PLAYERS.ORANGE ? O_RAT_IDX : Y_RAT_IDX;
        const friendlyDogIdx = playerForMax === PLAYERS.ORANGE ? O_DOG_IDX : Y_DOG_IDX;
        const opponentRatIdx = playerForMax === PLAYERS.ORANGE ? Y_RAT_IDX : O_RAT_IDX;
        const opponentDogIdx = playerForMax === PLAYERS.ORANGE ? Y_DOG_IDX : O_DOG_IDX;
        const friendlyRatBB = bitboards[friendlyRatIdx] ?? BB_EMPTY;
        const friendlyDogBB = bitboards[friendlyDogIdx] ?? BB_EMPTY;
        const opponentRatBB = bitboards[opponentRatIdx] ?? BB_EMPTY;
        const opponentDogBB = bitboards[opponentDogIdx] ?? BB_EMPTY;

        if (typeof waterBB !== 'undefined') {
            const friendlySwimmersInWaterBB = (friendlyRatBB | friendlyDogBB) & waterBB;
            const opponentSwimmersInWaterBB = (opponentRatBB | opponentDogBB) & waterBB;
            score += popcount(friendlySwimmersInWaterBB) * EVAL_WATER_CONTROL_BONUS;
            score += popcount(opponentSwimmersInWaterBB) * EVAL_OPP_WATER_CONTROL_PENALTY;
        } else { console.warn(`[${fnName} Warn] waterBB not available for water control evaluation.`); }
        score = Math.max(EVAL_LOSE_SCORE / 1.5, Math.min(EVAL_WIN_SCORE / 1.5, score));
        if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Water Control.`); score = 0; }
    } catch(e) { console.error(`[${fnName} Error] During water control check:`, e); }


    // --- Hungry State Evaluation (Value-Based) ---
    try {
        let ownHungryPenalty = 0;
        let tempMaxHungryBB = maxHungryBB;
        while (tempMaxHungryBB !== BB_EMPTY) {
            const lsb = lsbIndex(tempMaxHungryBB);
            if (lsb === -1) break;
            const coords = bitIndexToCoord(lsb);
            if (coords && piecesData[playerForMax]?.[coords]) {
                 const rank = piecesData[playerForMax][coords].rank;
                 const pieceValue = EVAL_PIECE_VALUES[rank] || 0;
                 ownHungryPenalty += pieceValue * EVAL_OWN_HUNGRY_VALUE_PENALTY_MULT;
            }
            tempMaxHungryBB = clearBit(tempMaxHungryBB, lsb);
        }
        score -= ownHungryPenalty;

        let oppHungryBonus = 0;
        let tempMinHungryBB = minHungryBB;
        while (tempMinHungryBB !== BB_EMPTY) {
            const lsb = lsbIndex(tempMinHungryBB);
            if (lsb === -1) break;
            const coords = bitIndexToCoord(lsb);
            if (coords && piecesData[opponent]?.[coords]) {
                 const rank = piecesData[opponent][coords].rank;
                 const pieceValue = EVAL_PIECE_VALUES[rank] || 0;
                 oppHungryBonus += pieceValue * EVAL_OPP_HUNGRY_VALUE_BONUS_MULT;
            }
            tempMinHungryBB = clearBit(tempMinHungryBB, lsb);
        }
        score += oppHungryBonus;

        score = Math.max(EVAL_LOSE_SCORE / 1.5, Math.min(EVAL_WIN_SCORE / 1.5, score));
        if (!Number.isFinite(score)) { console.warn(`[${fnName}] Score non-finite after Value-Based Hungry State.`); score = 0; }

    } catch (e) { console.error(`[${fnName} Error] During value-based hungry check:`, e); }
    // --- End Hungry State Evaluation ---


    // --- Final Clamping and Return ---
    if (!Number.isFinite(score)) {
        console.error(`[${fnName} FATAL] Score became non-finite (${score}) before final clamp. Returning 0.`);
        score = 0;
    }
    const finalScore = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, score));

    if (!Number.isFinite(finalScore)) {
        console.error(`[${fnName} FATAL] Final score is non-finite (${finalScore}) after clamp. Returning 0.`);
        return 0;
    }
    return finalScore;
}


// --- Search ---

/**
 * Checks if the specified player has any move that wins immediately (reaches opponent's den).
 * Uses bitboard representation and bitboard move generation.
 * Checks hungry state before declaring a den move as a win.
 * Depends on: getAllValidMovesBB, coordToBitIndex, getBit (bitboardUtils.js),
 *             orangeDenBB, yellowDenBB (bitboardUtils.js state), PLAYERS (constants.js),
 *             gameState (for hungryBB access).
 *
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW) whose winning moves to check.
 * @param {boolean} [isSimulation=false] - Flag to suppress logging.
 * @returns {object|null} The winning move object { from, to, pieceTypeIndex } or null if no immediate win found.
 */
function findImmediateWinningMove(bitboards, player, isSimulation = false) {
    const opponentDenBB = player === PLAYERS.ORANGE ? yellowDenBB : orangeDenBB;

    if (opponentDenBB === BB_EMPTY) {
        if (!isSimulation) console.error("findImmediateWinningMove: Opponent Den Bitboard is empty!");
        return null;
    }

    let moves = [];
    try {
        moves = getAllValidMovesBB(bitboards, player, isSimulation);
    } catch (e) {
        if (!isSimulation) console.error("findImmediateWinningMove: Error getting moves:", e);
        return null;
    }

    // if (!isSimulation) {
    //     console.log(`[AI Win Check BB] Checking ${moves.length} moves for immediate win.`);
    // }

    // Access the correct hungry bitboard from the global state
    const currentHungryBB = gameState.hungryBB?.[player] ?? BB_EMPTY;

    for (const move of moves) {
        if (!move || !move.to || typeof move.pieceTypeIndex !== 'number') continue;

        const toIndex = coordToBitIndex(move.to);
        const fromIndex = coordToBitIndex(move.from); // Need fromIndex for hungry check

        if (toIndex !== -1 && fromIndex !== -1 && getBit(opponentDenBB, toIndex) !== 0n) {
            // Found a move landing on the den square. Now check hunger.
            const isHungry = getBit(currentHungryBB, fromIndex) !== 0n;

            if (!isSimulation) {
                if (isHungry) {
                    // console.log(`[AI Win Check BB] Potential win ${move.from}->${move.to} discarded (Hungry).`);
                } else {
                    // console.log(`[AI Win Check BB] Found VALID win ${move.from}->${move.to}.`);
                }
            }

            if (!isHungry) {
                return move; // Return the winning move
            }
        }
    }

    // if (!isSimulation) {
    //     console.log(`[AI Win Check BB] No immediate winning move found.`);
    // }
    return null;
}


/**
 * Quiescence Search using Bitboards. Extends search for noisy moves (captures).
 * Generates capture moves ONCE per node, **validates them with isValidMoveBB**, and uses evaluateBoardBB.
 * Includes time/cancel checks, repetition checks, stand-pat pruning.
 * **Includes an explicit check for immediate threats before calculating stand-pat score.**
 * Includes checks and clamping for non-finite scores.
 * Depends on: nodeCount, searchCancelled, timeLimit, searchStartTime globals,
 *             transpositionTable global (reads), gameState.boardStateHistory global (reads),
 *             MAX_SEARCH_DEPTH, MAX_QUIESCENCE_DEPTH, EVAL_WIN_SCORE, EVAL_LOSE_SCORE,
 *             EVAL_MATED_SCORE_THRESHOLD, TT_ENTRY_TYPE, BB_IDX, PLAYERS (constants.js),
 *             evaluateBoardBB, getAllValidMovesBB, simulateMoveBB, isValidMoveBB (gameLogic.js),
 *             getPieceCountsBB, getRestrictedPlayer, coordToBitIndex, bitIndexToCoord, getBit, lsbIndex, clearBit (bitboardUtils.js),
 *             EVAL_PIECE_VALUES, O_RAT_IDX, O_ELEPHANT_IDX, Y_RAT_IDX, Y_ELEPHANT_IDX (constants.js).
 *
 * @param {bigint[]} bitboards - Current bitboard state.
 * @param {string} currentPlayer - Player whose turn it is.
 * @param {bigint} currentHash - Zobrist hash of this state.
 * @param {number} alpha - Lower bound for currentPlayer.
 * @param {number} beta - Upper bound for currentPlayer.
 * @param {number} ply - Current total search depth from the root (0 at root).
 * @returns {number} Evaluated score for the stable position, relative to currentPlayer. GUARANTEED Finite & Clamped.
 */
function qsearchBB(bitboards, currentPlayer, currentHash, alpha, beta, ply) {
    nodeCount++;
    const fnName = "qsearchBB";

    // --- Time & Cancellation Checks ---
    if (searchCancelled || (timeLimit > 0 && (nodeCount & 1023) === 0 && performance.now() - searchStartTime > timeLimit)) {
        if (!searchCancelled) { searchCancelled = true; }
        return 0;
    }
    if (searchCancelled) return 0;

    // --- Max Depth Check ---
    if (ply >= MAX_SEARCH_DEPTH + MAX_QUIESCENCE_DEPTH) {
        try {
            let evalScore = evaluateBoardBB(bitboards, currentPlayer);
             if (!Number.isFinite(evalScore)) { // Check eval result
                  console.error(`!!! NON-FINITE SCORE (${evalScore}) from Max Depth Eval @ P${ply}`);
                  evalScore = 0; // Assign safe value
             }
            // Clamp the result from evaluation
            return Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, evalScore));
        } catch (e) { console.error(`[${fnName} MaxDepth Eval Error] P${ply}:`, e); return 0; }
    }

    // --- Repetition Check ---
    const hashKey = currentHash.toString();
    const repetitionCount = gameState.boardStateHistory[hashKey] || 0;
    if (repetitionCount >= 2 && ply > 0) {
        const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(bitboards);
        const restrictedPlayerAtNode = getRestrictedPlayer(orangeCount, yellowCount);
        if (currentPlayer === restrictedPlayerAtNode) {
            return 0;
        }
    }

    // --- <<<< START: Explicit Stand-Pat Threat Check >>>> ---
    let immediateLosingPenalty = 0;
    const qPlayerPiecesData = {};
    const qOpponent = currentPlayer === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;

    try {
        const playerPieceStart = currentPlayer === PLAYERS.ORANGE ? O_RAT_IDX : Y_RAT_IDX;
        const playerPieceEnd = currentPlayer === PLAYERS.ORANGE ? O_ELEPHANT_IDX : Y_ELEPHANT_IDX;
        for (let pieceTypeIndex = playerPieceStart; pieceTypeIndex <= playerPieceEnd; pieceTypeIndex++) {
            const rank = (pieceTypeIndex % 8) + 1;
            let tempBB = bitboards[pieceTypeIndex];
            while (tempBB !== BB_EMPTY) {
                const lsb = lsbIndex(tempBB);
                if (lsb === -1) break;
                qPlayerPiecesData[lsb] = { rank: rank, value: EVAL_PIECE_VALUES[rank] || 0 };
                tempBB = clearBit(tempBB, lsb);
            }
        }
    } catch (e) { console.error(`[${fnName} Error] Collecting piece data for stand-pat check:`, e); }

    let qOpponentMoves = [];
    try {
       qOpponentMoves = getAllValidMovesBB(bitboards, qOpponent, true);
    } catch(e) { console.error(`[${fnName} Error] Generating opponent moves for stand-pat check:`, e); }

    for (const lsbStr in qPlayerPiecesData) {
         const myIndex = parseInt(lsbStr, 10);
         const myData = qPlayerPiecesData[myIndex];
         if (!myData) continue;
         const myRank = myData.rank;
         const myValue = myData.value;

         for (const oppMove of qOpponentMoves) {
             if (coordToBitIndex(oppMove.to) === myIndex) {
                 const attackerRank = (oppMove.pieceTypeIndex % 8) + 1;
                 const oppFromIdx = coordToBitIndex(oppMove.from);
                 if (oppFromIdx !== -1) {
                     const captureValidation = isValidMoveBB(oppFromIdx, myIndex, oppMove.pieceTypeIndex, qOpponent, bitboards);
                     if (captureValidation.valid) {
                         const isRatVsElephantValidAttack = (attackerRank === 1 && myRank === 8);
                         const isStandardLosingCapture = (!isRatVsElephantValidAttack && (attackerRank >= myRank || (attackerRank === 8 && myRank === 1)));
                         if (isStandardLosingCapture || isRatVsElephantValidAttack) {
                              const penaltyMultiplier = 1.8; // Standard penalty multiplier
                              immediateLosingPenalty += myValue * penaltyMultiplier;
                              break;
                         }
                     }
                 }
             }
         }
    }
    // --- <<<< END: Explicit Stand-Pat Threat Check >>>> ---


    // --- Stand-Pat Score ---
    let standPatScore;
    try {
        standPatScore = evaluateBoardBB(bitboards, currentPlayer);
        if (!Number.isFinite(standPatScore)) { // Check eval result
             console.error(`!!! NON-FINITE SCORE (${standPatScore}) from evaluateBoardBB in QSearch @ P${ply}`);
             standPatScore = 0; // Assign safe value
        }
        standPatScore -= immediateLosingPenalty;
        if (!Number.isFinite(standPatScore)) { // Check after penalty
             console.error(`!!! NON-FINITE SCORE (${standPatScore}) after Stand-Pat penalty @ P${ply}`);
             standPatScore = EVAL_LOSE_SCORE; // Assign safe value
        }
        standPatScore = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, standPatScore)); // Clamp
    } catch (e) {
        console.error(`[${fnName} Eval Error] P${ply}:`, e);
        standPatScore = EVAL_LOSE_SCORE - immediateLosingPenalty;
        standPatScore = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, standPatScore)); // Clamp even on error
    }

    // --- Stand-Pat Pruning ---
    if (standPatScore >= beta) {
        // Return clamped value
        return Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, beta));
    }
    alpha = Math.max(alpha, standPatScore);


    // --- Generate & VALIDATE Noisy Moves (Captures Only) ---
    let noisyMoves = [];
    try {
        // ... (move generation logic remains the same) ...
        const allPseudoMoves = getAllValidMovesBB(bitboards, currentPlayer, true);
        const opponentBBIndex = currentPlayer === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
        const opponentPiecesBB = bitboards[opponentBBIndex];

        for (const move of allPseudoMoves) {
            if (!move || !move.to || typeof move.pieceTypeIndex !== 'number') continue;
            const toIndex = coordToBitIndex(move.to);
            if (toIndex !== -1 && getBit(opponentPiecesBB, toIndex) !== 0n) {
                const fromIndex = coordToBitIndex(move.from);
                if (fromIndex !== -1) {
                    const validation = isValidMoveBB(fromIndex, toIndex, move.pieceTypeIndex, currentPlayer, bitboards);
                    if (validation.valid) {
                        noisyMoves.push(move);
                    }
                }
            }
        }
        if (noisyMoves.length > 1) {
            noisyMoves = getOrderedMovesBB(bitboards, null, ply, noisyMoves, currentPlayer);
        }
    } catch (e) {
        console.error(`[${fnName} Error] Error generating/validating noisy moves at ply ${ply}:`, e);
    }

     if (noisyMoves.length === 0) {
         // Return the already clamped and potentially penalized standPatScore
         return standPatScore;
     }

     // --- Explore Valid Captures ---
     // Initialize bestScore with the (already clamped) standPatScore
     let bestScore = standPatScore;

     for (const move of noisyMoves) {
         const simResult = simulateMoveBB(bitboards, currentPlayer, currentHash, move);
         if (!simResult) continue;
         const { nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner } = simResult;

         const nextHashKey = nextHash.toString();
         gameState.boardStateHistory[nextHashKey] = (gameState.boardStateHistory[nextHashKey] || 0) + 1;

         let score;
         if (nextGameOver) {
             if (nextWinner === currentPlayer) score = EVAL_WIN_SCORE - (ply + 1);
             else if (nextWinner === null) score = 0;
             else score = EVAL_LOSE_SCORE + (ply + 1);
         } else {
             score = -qsearchBB(nextBitboards, nextPlayer, nextHash, -beta, -alpha, ply + 1);
             // <<< CHECK SCORE >>>
             if (!Number.isFinite(score)) {
                  console.error(`!!! NON-FINITE SCORE (${score}) after QSearch recursion @ P${ply} for move ${move.from}->${move.to}`);
                  score = EVAL_LOSE_SCORE + ply + 1; // Assign safe, penalized value
             }
         }

         gameState.boardStateHistory[nextHashKey]--;
         if (gameState.boardStateHistory[nextHashKey] <= 0) {
             delete gameState.boardStateHistory[nextHashKey];
         }

         if (searchCancelled) return 0;

         // Clamp the score before processing
         score = Math.max(EVAL_LOSE_SCORE + ply + 1, Math.min(EVAL_WIN_SCORE - ply - 1, score));

         bestScore = Math.max(bestScore, score);
         alpha = Math.max(alpha, bestScore);

         if (alpha >= beta) {
             // <<< CLAMP RETURN VALUE for beta cutoff >>>
             return Math.max(EVAL_LOSE_SCORE + ply, Math.min(EVAL_WIN_SCORE - ply, beta));
         }
     }

     // Return the best score found, ensuring it's finite and clamped
     // bestScore was initialized with clamped standPatScore and updated with clamped recursive scores
     if (!Number.isFinite(bestScore)){
        console.error(`!!! NON-FINITE bestScore (${bestScore}) at end of QSearch @ P${ply}. Returning standPat.`);
        return standPatScore; // standPatScore is guaranteed finite and clamped
     }
     // Final clamp just to be absolutely sure
     return Math.max(EVAL_LOSE_SCORE + ply, Math.min(EVAL_WIN_SCORE - ply, bestScore));
}


/**
 * Negamax search function using Bitboards with Alpha-Beta Pruning, TT, Killers, History, NMP, LMR, FP.
 * Generates moves ONCE per node. Calls evaluateBoardBB and qsearchBB.
 * Handles repetition check dynamically within the search loop.
 * Validates captures and hungry den entries before exploring.
 * Includes checks and clamping for non-finite scores.
 * *** Includes an explicit check to prevent obvious "suicide" moves (moving next to a capturable higher-ranked piece). Reverted to simpler version (ignores forced hunger). ***
 * Depends on: nodeCount, searchCancelled, timeLimit, searchStartTime, killerMoves, historyHeuristic globals,
 *             transpositionTable global (read/write), gameState.boardStateHistory global (read/write),
 *             MAX_SEARCH_DEPTH, EVAL_*, TT_ENTRY_TYPE, NMP_*, LMR_*, FP_*, BB_IDX, PLAYERS (constants.js),
 *             qsearchBB, evaluateBoardBB, getAllValidMovesBB, simulateMoveBB, getOrderedMovesBB,
 *             isValidMoveBB, // Removed checkHungerAfterCapture dependency for this check
 *             addKillerMove, updateHistoryScore, getPieceCountsBB, getRestrictedPlayer,
 *             coordToBitIndex, getBit, toggleTurnKey, orangeDenBB, yellowDenBB, waterBB,
 *             O_RAT_IDX, Y_ELEPHANT_IDX, Y_RAT_IDX, O_ELEPHANT_IDX,
 *             bitIndexToCoord, clearBit, lsbIndex (bitboardUtils.js/gameState.js/gameLogic.js).
 *
 * @param {number} depth - Remaining depth to search.
 * @param {bigint[]} bitboards - Current bitboard state.
 * @param {string} currentPlayer - Player whose turn it is in this state.
 * @param {bigint} currentHash - Zobrist hash of this state.
 * @param {boolean} isGameOver - Is the game over in this state? (Passed from parent)
 * @param {string|null} winner - Who won if game is over? (Passed from parent)
 * @param {number} alpha - Lower bound for current player.
 * @param {number} beta - Upper bound for current player.
 * @param {string} playerForMax - The AI player (needed for eval perspective, usually Yellow).
 * @param {number} ply - Current depth from the root (0 at root).
 * @param {boolean} [canNullMove=true] - Flag if null move is allowed at this node.
 * @param {boolean} [inCheck=false] - Flag if currentPlayer is in check (simplified - currently unused).
 * @returns {number} Evaluated score relative to the currentPlayer. GUARANTEED Finite & Clamped.
 */
function searchBB(depth, bitboards, currentPlayer, currentHash, isGameOver, winner, alpha, beta, playerForMax, ply, canNullMove = true, inCheck = false) {
    nodeCount++;
    const nodePlayer = currentPlayer;
    const originalAlpha = alpha;
    const hashKey = currentHash.toString();
    const opponent = nodePlayer === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const opponentBBIndex = nodePlayer === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;


    // --- Time & Cancellation Checks ---
    if (searchCancelled || (timeLimit > 0 && (nodeCount & 2047) === 0 && performance.now() - searchStartTime > timeLimit)) {
        if (!searchCancelled) { searchCancelled = true; }
        return 0; // Return neutral score on cancellation
    }
    if (searchCancelled) return 0;

    // --- Repetition Check ---
    const repetitionCount = gameState.boardStateHistory[hashKey] || 0;
    if (repetitionCount >= 2 && ply > 0) {
        const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(bitboards);
        const restrictedPlayerAtNode = getRestrictedPlayer(orangeCount, yellowCount);
        if (nodePlayer === restrictedPlayerAtNode) {
            return 0; // Draw by repetition rule
        }
    }

    // --- Game Over Check ---
    if (isGameOver) {
        let score = 0;
        if (winner === nodePlayer) score = EVAL_WIN_SCORE - ply; // Closer mate is better
        else if (winner === null) score = 0; // Draw
        else score = EVAL_LOSE_SCORE + ply; // Later loss is better
        // Clamp and ensure finite before returning
        return Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, score));
    }

    // --- Max Depth Check -> Quiescence Search ---
    if (depth <= 0) {
        let qScore = qsearchBB(bitboards, nodePlayer, currentHash, alpha, beta, ply);
        // Ensure qsearch returns finite and clamped score
        if (!Number.isFinite(qScore)) {
            console.error(`!!! NON-FINITE SCORE (${qScore}) from QSearch @ P${ply}`);
            qScore = 0; // Default to draw score if qsearch fails
        }
        // Clamp result from QSearch as well
        return Math.max(EVAL_LOSE_SCORE + ply + 1, Math.min(EVAL_WIN_SCORE - ply - 1, qScore));
    }

    // --- Transposition Table Lookup ---
    let ttBestMove = null;
    const ttEntry = transpositionTable.get(hashKey);
    if (ttEntry && ttEntry.depth >= depth) {
        let ttScore = ttEntry.score;
        // Adjust mate scores based on ply stored vs current ply
        if (ttScore > EVAL_MATE_SCORE_THRESHOLD) ttScore -= ply;
        else if (ttScore < EVAL_MATED_SCORE_THRESHOLD) ttScore += ply;
        const ttType = ttEntry.type;

        if (Number.isFinite(ttScore)) {
            // Clamp TT score to absolute bounds before using it
            ttScore = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, ttScore));
            if (ttType === TT_ENTRY_TYPE.EXACT) { return ttScore; }
            if (ttType === TT_ENTRY_TYPE.LOWER_BOUND && ttScore >= beta) { return ttScore; } // Return score directly, it's already clamped
            if (ttType === TT_ENTRY_TYPE.UPPER_BOUND && ttScore <= alpha) { return ttScore; } // Return score directly, it's already clamped
        } else {
             console.warn(`[SearchBB Warn P${ply} D${depth}] Non-finite score ${ttEntry.score} found in TT. Ignoring entry score.`);
        }
        if (ttEntry.bestMove) ttBestMove = ttEntry.bestMove;
    }

    // --- Null Move Pruning (NMP) & Futility Pruning Prep ---
    let staticEval = -Infinity; // Initialize safely
    let didStaticEval = false;
    const needsStaticEval = (canNullMove && depth >= NMP_MIN_DEPTH && ply > 0 && !inCheck) || (depth <= FP_MAX_DEPTH && !inCheck);

    if (needsStaticEval) {
        try {
            staticEval = evaluateBoardBB(bitboards, nodePlayer);
             if (!Number.isFinite(staticEval)) {
                  console.error(`!!! NON-FINITE SCORE (${staticEval}) from evaluateBoardBB @ P${ply} D${depth}`);
                  staticEval = 0;
             }
             // Clamp static eval just in case evaluateBoardBB had an issue despite internal clamps
             staticEval = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, staticEval));
            didStaticEval = true;
        }
        catch (e) { console.error(`[SearchBB Eval Err] P${ply} D${depth}:`, e); staticEval = EVAL_LOSE_SCORE; didStaticEval = true; }
    }

    // --- Null Move Pruning ---
    const canTryNMP = canNullMove && depth >= NMP_MIN_DEPTH && ply > 0 && !inCheck && didStaticEval && staticEval >= beta;
    if (canTryNMP) {
        const nextPlayerNMP = nodePlayer === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
        const nextHashNMP = toggleTurnKey(currentHash);
        const reduction = NMP_REDUCTION;
        const nmpHashKey = nextHashNMP.toString();
        gameState.boardStateHistory[nmpHashKey] = (gameState.boardStateHistory[nmpHashKey] || 0) + 1;
        let nullScore = -searchBB(depth - 1 - reduction, bitboards, nextPlayerNMP, nextHashNMP, false, null, -beta, -beta + 1, playerForMax, ply + 1, false, false);
        gameState.boardStateHistory[nmpHashKey]--;
        if (gameState.boardStateHistory[nmpHashKey] <= 0) { delete gameState.boardStateHistory[nmpHashKey]; }

        if (searchCancelled) return 0;

        if (!Number.isFinite(nullScore)) {
             console.warn(`!!! NON-FINITE SCORE (${nullScore}) from NMP recursive call @ P${ply} D${depth}`);
             nullScore = EVAL_LOSE_SCORE; // Treat as failure
        }

        // Clamp the NMP result before comparison
        nullScore = Math.max(EVAL_LOSE_SCORE + ply + 1, Math.min(EVAL_WIN_SCORE - ply - 1, nullScore));

        if (nullScore >= beta) {
            let scoreToStore = beta; // Store beta as the lower bound
            // Adjust mate scores relative to current ply before storing
            if (scoreToStore > EVAL_MATE_SCORE_THRESHOLD) scoreToStore += ply; else if (scoreToStore < EVAL_MATED_SCORE_THRESHOLD) scoreToStore -= ply;
            // Store only if finite
            if (Number.isFinite(scoreToStore)) {
                 const existing = transpositionTable.get(hashKey);
                 if (!existing || depth >= existing.depth) {
                      transpositionTable.set(hashKey, { depth: depth, score: scoreToStore, type: TT_ENTRY_TYPE.LOWER_BOUND, bestMove: null });
                 }
            }
            return beta; // Return the cutoff score (already clamped)
        }
    }

    // --- Generate & Order Moves ---
    let movesToConsider = [];
    try {
        const initialPossibleMoves = getAllValidMovesBB(bitboards, nodePlayer, true);
        if (initialPossibleMoves.length === 0) {
             return 0; // Stalemate score
        }
        movesToConsider = getOrderedMovesBB(bitboards, ttBestMove, ply, initialPossibleMoves, nodePlayer);
    } catch (e) { console.error(`[SearchBB Error P${ply} D${depth}] Error getting/ordering moves:`, e); return EVAL_LOSE_SCORE + ply; }

    // --- Search Moves Loop ---
    let bestScore = EVAL_LOSE_SCORE - 1;
    let bestMoveFound = null;
    let movesSearched = 0;
    let generatedOpponentMoves = null; // Cache opponent moves per node

    for (const move of movesToConsider) {
        if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') continue;
        const fromIndex = coordToBitIndex(move.from);
        const toIndex = coordToBitIndex(move.to);
        if (fromIndex === -1 || toIndex === -1) continue;

        const validation = isValidMoveBB(fromIndex, toIndex, move.pieceTypeIndex, nodePlayer, bitboards);
        if (!validation.valid) continue;

        movesSearched++;

        // <<<--- START SIMPLIFIED SUICIDE MOVE CHECK --->>>
        let isSuicidalMove = false;
        const isCaptureMove = getBit(bitboards[opponentBBIndex], toIndex) !== 0n;

        if (!isCaptureMove) {
            const attackerRank = (move.pieceTypeIndex % 8) + 1;
            let winningAttackerFound = false;

            if (generatedOpponentMoves === null) {
                try { generatedOpponentMoves = getAllValidMovesBB(bitboards, opponent, true); }
                catch (e) { console.error(`[SearchBB SuicideCheck Err P${ply} D${depth}] Getting opponent moves:`, e); generatedOpponentMoves = []; }
            }

            for (const oppMove of generatedOpponentMoves) {
                const oppFromIndex = coordToBitIndex(oppMove.from);
                const oppToIndex = coordToBitIndex(oppMove.to);

                if (oppToIndex === toIndex && oppFromIndex !== -1) {
                     const opponentRank = (oppMove.pieceTypeIndex % 8) + 1;
                     const isOpponentFromWater = getBit(waterBB, oppFromIndex) !== 0n;
                     const isAttackerRat = attackerRank === 1;
                     const isAttackerElephant = attackerRank === 8;
                     const isOpponentRat = opponentRank === 1;
                     const isOpponentElephant = opponentRank === 8;

                    // --- Rank Check: Does the opponent piece win the engagement? ---
                    let opponentWinsCapture = false;
                    if (isAttackerRat && isOpponentElephant) { opponentWinsCapture = true; }
                    else if (isAttackerElephant && isOpponentRat) { opponentWinsCapture = isOpponentFromWater; }
                    else { opponentWinsCapture = (opponentRank >= attackerRank); }
                    // --- End Rank Check ---

                    if (opponentWinsCapture) {
                        const oppAttackValidation = isValidMoveBB(oppFromIndex, oppToIndex, oppMove.pieceTypeIndex, opponent, bitboards);
                        if (oppAttackValidation.valid) {
                            winningAttackerFound = true;
                            break; // Found a valid, winning attacker
                        }
                    }
                }
            } // End opponent moves loop

            // --- Decision Logic (Simpler: prune if ANY valid winning attacker exists) ---
            if (winningAttackerFound) {
                isSuicidalMove = true;
                // console.log(`%c[SUICIDE PRUNE (Simple) P${ply}]%c Pruning: ${move.from}->${move.to}`, 'color: #e65100; font-weight: bold;', 'color: inherit;'); // DEBUG LOG (Commented out)
            }
        } // End if (!isCaptureMove)

        if (isSuicidalMove) {
            movesSearched--;
            continue; // Skip this move entirely
        }
        // <<<--- END SIMPLIFIED SUICIDE MOVE CHECK --->>>


        // --- Simulate the move (only if not suicidal) ---
        const simResult = simulateMoveBB(bitboards, nodePlayer, currentHash, move);
        if (!simResult) {
             console.warn(`[SearchBB Warn P${ply} D${depth}] Simulation failed for move ${move.from}->${move.to} after validation/suicide check.`);
             movesSearched--; // Decrement as we didn't search
             continue;
        }
        const { nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, capturedPieceTypeIndex } = simResult;

        const nextHashKey = nextHash.toString();
        gameState.boardStateHistory[nextHashKey] = (gameState.boardStateHistory[nextHashKey] || 0) + 1;

        const isCapture = capturedPieceTypeIndex !== null;
        const isNoisy = isCapture;

        // --- Futility Pruning ---
        let skipMove = false;
        if (!isNoisy && !inCheck && depth <= FP_MAX_DEPTH && didStaticEval) {
            const futilityMargin = FP_MARGIN_PER_DEPTH * depth;
            if (staticEval + futilityMargin <= alpha) {
                 skipMove = true;
                 bestScore = Math.max(bestScore, staticEval + futilityMargin);
            }
        }

        let score = EVAL_LOSE_SCORE - 1;
        if (!skipMove) {
            let reduction = 0;
            if (depth >= LMR_MIN_DEPTH && movesSearched > LMR_MOVE_COUNT_THRESHOLD && !isNoisy && !inCheck) {
                reduction = LMR_BASE_REDUCTION;
            }

            let searchDepth = Math.max(0, depth - 1 - reduction);
            if (searchDepth < 0) searchDepth = 0;

            if (movesSearched === 1) { // Full window search
                score = -searchBB(searchDepth, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, ply + 1, true, false);
            } else { // Null window search
                score = -searchBB(searchDepth, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -alpha - 1, -alpha, playerForMax, ply + 1, true, false);
                if (!searchCancelled && score > alpha && score < beta) { // Re-search
                    score = -searchBB(searchDepth, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, ply + 1, true, false);
                }
            }
        } // End if(!skipMove)

        gameState.boardStateHistory[nextHashKey]--;
        if (gameState.boardStateHistory[nextHashKey] <= 0) {
            delete gameState.boardStateHistory[nextHashKey];
        }

        if (searchCancelled) return 0;

        // <<< CHECK SCORE FOR FINITE >>>
        if (!Number.isFinite(score)) {
             console.warn(`[SearchBB Warn P${ply} D${depth}] Score became non-finite (${score}) after processing move ${move.from}->${move.to}. Treating as loss.`);
             score = EVAL_LOSE_SCORE + ply + 1;
        }

        // Clamp score before comparison
        score = Math.max(EVAL_LOSE_SCORE + ply + 1, Math.min(EVAL_WIN_SCORE - ply - 1, score));

        // --- Update Best Score & Alpha ---
        if (score > bestScore) {
            bestScore = score;
            bestMoveFound = move;
            if (bestScore >= beta) { // Beta Cutoff check
                if (!isCapture && bestMoveFound) {
                    addKillerMove(ply, bestMoveFound);
                    const toSquareIndexHist = coordToBitIndex(bestMoveFound.to);
                    if (toSquareIndexHist !== -1) {
                         updateHistoryScore(bestMoveFound.pieceTypeIndex, toSquareIndexHist, depth * depth);
                    }
                }
                let scoreToStore = beta;
                if (scoreToStore > EVAL_MATE_SCORE_THRESHOLD) scoreToStore += ply; else if (scoreToStore < EVAL_MATED_SCORE_THRESHOLD) scoreToStore -= ply;
                if (Number.isFinite(scoreToStore)) {
                     const existingCutoff = transpositionTable.get(hashKey);
                     if (!existingCutoff || depth >= existingCutoff.depth) {
                          transpositionTable.set(hashKey, { depth: depth, score: scoreToStore, type: TT_ENTRY_TYPE.LOWER_BOUND, bestMove: bestMoveFound });
                     }
                }
                return Math.max(EVAL_LOSE_SCORE + ply, Math.min(EVAL_WIN_SCORE - ply, beta));
            }
            alpha = Math.max(alpha, bestScore);
        }

    } // End of move loop

    if (searchCancelled) return 0;

    if (movesSearched === 0 && bestScore === EVAL_LOSE_SCORE - 1) {
       return 0;
    }
    if (bestScore === EVAL_LOSE_SCORE - 1) {
         return Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, originalAlpha));
    }

    // --- Store TT Entry ---
    let entryType = (bestScore <= originalAlpha) ? TT_ENTRY_TYPE.UPPER_BOUND : TT_ENTRY_TYPE.EXACT;
    let scoreForStorage = bestScore;
    if (scoreForStorage > EVAL_MATE_SCORE_THRESHOLD) scoreForStorage += ply; else if (scoreForStorage < EVAL_MATED_SCORE_THRESHOLD) scoreForStorage -= ply;
    if (Number.isFinite(scoreForStorage)) {
         const existingFinal = transpositionTable.get(hashKey);
         if (!existingFinal || depth > existingFinal.depth || (depth === existingFinal.depth && entryType === TT_ENTRY_TYPE.EXACT) || (depth === existingFinal.depth && existingFinal.type !== TT_ENTRY_TYPE.EXACT)) {
              transpositionTable.set(hashKey, { depth: depth, score: scoreForStorage, type: entryType, bestMove: bestMoveFound });
         }
    } else {
          console.warn(`[SearchBB Warn P${ply} D${depth}] Attempted to store non-finite score ${bestScore} in TT.`);
    }

    // --- Return final best score for this node, clamped ---
    if (!Number.isFinite(bestScore)) {
         console.error(`[SearchBB FATAL P${ply} D${depth}] Final bestScore is non-finite (${bestScore}). Returning 0.`);
         bestScore = 0;
    }
    return bestScore;
}


// **** Replace in ai.js ****

/**
 * Finds the best move for the AI at the root of the search using Bitboards.
 * Uses the Negamax search function (`searchBB`) internally.
 * Handles potentially large scores, clamping, and non-finite scores.
 * Includes check for immediate wins before starting search.
 * *** Includes an explicit check to prevent obvious "suicide" moves at the root (ignores forced hunger). ***
 * Returns an ordered list of evaluated root moves, with stable sorting for ties.
 * Depends on: transpositionTable global (write), EVAL_WIN_SCORE, EVAL_LOSE_SCORE,
 *             EVAL_MATED_SCORE_THRESHOLD, TT_ENTRY_TYPE (constants.js), searchBB, simulateMoveBB,
 *             getAllValidMovesBB, getOrderedMovesBB, findImmediateWinningMove, evaluateBoardBB,
 *             isValidMoveBB, // Removed checkHungerAfterCapture dependency
 *             getBit, coordToBitIndex, bitIndexToCoord, waterBB,
 *             O_RAT_IDX, Y_ELEPHANT_IDX, Y_RAT_IDX, O_ELEPHANT_IDX, BB_IDX, PLAYERS
 *
 * @param {number} depth - The maximum search depth for this iteration.
 * @param {bigint[]} rootBitboards - The starting bitboard state.
 * @param {string} playerForMax - The player the AI is playing as (usually YELLOW).
 * @param {bigint} rootHash - The Zobrist hash of the root state.
 * @param {boolean} rootGameOver - Is the game already over at the root?
 * @param {string|null} rootWinner - Who won if game is over?
 * @returns {{moves: Array<{move: object|null, score: number, originalIndex: number}>}|null} A list of root moves ordered by score (best first),
 *          including original index for stable sorting. Returns null on critical error.
 *          Returns { moves: [{ move: null, score: number, originalIndex: -1 }] } if game over or stalemate.
 */
function findBestMoveMinimaxBB(depth, rootBitboards, playerForMax, rootHash, rootGameOver, rootWinner) {
    let evaluatedRootMoves = []; // Store { move, score, originalIndex } tuples
    let alpha = -Infinity;
    let beta = Infinity;
    const opponent = playerForMax === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const opponentBBIndex = playerForMax === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
    let generatedOpponentMovesRoot = null; // Cache opponent moves for root checks

    // --- Initial Validation & Game Over Check ---
    if (!rootBitboards || typeof rootHash !== 'bigint') {
        console.error("[findBestMoveMinimaxBB Error] Invalid root state provided.");
        return null;
    }
    if (rootGameOver) {
        let score = 0; // Default draw
        if (rootWinner === playerForMax) score = EVAL_WIN_SCORE;
        else if (rootWinner !== null) score = EVAL_LOSE_SCORE;
        return { moves: [{ move: null, score: score, originalIndex: -1 }] }; // No move to make
    }

    // --- Get and Order Root Moves ---
    let possibleMoves = [];
    try {
        possibleMoves = getAllValidMovesBB(rootBitboards, playerForMax, true);
        if (possibleMoves.length === 0) {
            return { moves: [{ move: null, score: EVAL_LOSE_SCORE + 1, originalIndex: -1 }] };
        }
        const rootTTEntry = transpositionTable.get(rootHash.toString());
        const ttBestMoveHint = rootTTEntry?.bestMove || null;
        possibleMoves = getOrderedMovesBB(rootBitboards, ttBestMoveHint, 0, possibleMoves, playerForMax); // Ply 0 at root
    } catch (e) {
        console.error(`[findBestMoveMinimaxBB D${depth}] Error getting/ordering root moves:`, e);
        return null;
    }

    // --- Evaluate Each Root Move ---
    for (let i = 0; i < possibleMoves.length; i++) {
        const move = possibleMoves[i];
        if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') continue;

        const fromIndex = coordToBitIndex(move.from);
        const toIndex = coordToBitIndex(move.to);
        if (fromIndex === -1 || toIndex === -1) continue;

        let scoreForThisMove;
        let isTracedMove = enableTracing && typeof TRACE_MOVE !== 'undefined' && move.from === TRACE_MOVE.from && move.to === TRACE_MOVE.to;
        let skipSearch = false; // Flag to skip the searchBB call if move is suicidal

        // <<<--- START SIMPLIFIED ROOT SUICIDE MOVE CHECK --->>>
        const isCaptureMoveRoot = getBit(rootBitboards[opponentBBIndex], toIndex) !== 0n;
        if (!isCaptureMoveRoot) {
            const attackerRankRoot = (move.pieceTypeIndex % 8) + 1;
            let winningAttackerFoundRoot = false;

            if (generatedOpponentMovesRoot === null) {
                try { generatedOpponentMovesRoot = getAllValidMovesBB(rootBitboards, opponent, true); }
                catch (e) { console.error(`[findBestMoveMinimaxBB RootSuicideCheck Err D${depth}] Getting opponent moves:`, e); generatedOpponentMovesRoot = []; }
            }

            for (const oppMove of generatedOpponentMovesRoot) {
                const oppFromIndexRoot = coordToBitIndex(oppMove.from);
                const oppToIndexRoot = coordToBitIndex(oppMove.to);

                if (oppToIndexRoot === toIndex && oppFromIndexRoot !== -1) {
                    const opponentRankRoot = (oppMove.pieceTypeIndex % 8) + 1;
                    const isOpponentFromWaterRoot = getBit(waterBB, oppFromIndexRoot) !== 0n;
                    const isAttackerRatRoot = attackerRankRoot === 1;
                    const isAttackerElephantRoot = attackerRankRoot === 8;
                    const isOpponentRatRoot = opponentRankRoot === 1;
                    const isOpponentElephantRoot = opponentRankRoot === 8;

                    // --- Rank Check: Does the opponent piece win the engagement? ---
                    let opponentWinsCaptureRoot = false;
                    if (isAttackerRatRoot && isOpponentElephantRoot) { opponentWinsCaptureRoot = true; }
                    else if (isAttackerElephantRoot && isOpponentRatRoot) { opponentWinsCaptureRoot = isOpponentFromWaterRoot; }
                    else { opponentWinsCaptureRoot = (opponentRankRoot >= attackerRankRoot); }
                    // --- End Rank Check ---

                    if (opponentWinsCaptureRoot) {
                        const oppAttackValidationRoot = isValidMoveBB(oppFromIndexRoot, oppToIndexRoot, oppMove.pieceTypeIndex, opponent, rootBitboards);
                        if (oppAttackValidationRoot.valid) {
                            winningAttackerFoundRoot = true;
                            break; // Found a valid, winning attacker
                        }
                    }
                }
            } // End loop opponent moves

             // --- Decision Logic (Simpler: penalize if ANY valid winning attacker exists) ---
             if (winningAttackerFoundRoot) {
                 skipSearch = true;
                 scoreForThisMove = EVAL_LOSE_SCORE + 1; // Penalize heavily
                 // console.log(`%c[ROOT SUICIDE (Simple)]%c Penalizing move: ${move.from}->${move.to}`, 'color: red; font-weight: bold;', 'color: inherit;'); // DEBUG LOG (Commented out)
             } else {
                  skipSearch = false; // Move is safe
             }
        } // End if !isCaptureMoveRoot
        // <<<--- END SIMPLIFIED ROOT SUICIDE MOVE CHECK --->>>

        if (!skipSearch) {
            // Only proceed with simulation and search if the move wasn't pruned at the root
            try {
                const simResult = simulateMoveBB(rootBitboards, playerForMax, rootHash, move);
                if (!simResult) {
                    console.warn(`[findBestMoveMinimaxBB D${depth}] Simulation failed for root move ${move.from}->${move.to}. Assigning loss score.`);
                    scoreForThisMove = EVAL_LOSE_SCORE - 1;
                } else {
                    const { nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner } = simResult;
                    const nextHashKey = nextHash.toString();
                    gameState.boardStateHistory[nextHashKey] = (gameState.boardStateHistory[nextHashKey] || 0) + 1;

                    const originalTraceState = enableTracing;
                    if (isTracedMove) {
                        // console.log(`[Trace ${move.from}->${move.to} D${depth}] ---> Calling searchBB(${depth - 1}, ..., ply=1)`); // DEBUG LOG (Commented out)
                        enableTracing = true;
                    }

                    scoreForThisMove = -searchBB(depth - 1, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, 1);

                    gameState.boardStateHistory[nextHashKey]--;
                    if (gameState.boardStateHistory[nextHashKey] <= 0) {
                        delete gameState.boardStateHistory[nextHashKey];
                    }

                    if (isTracedMove) {
                        enableTracing = originalTraceState;
                    }

                    if (!Number.isFinite(scoreForThisMove)) {
                        console.warn(`[findBestMoveMinimaxBB D${depth}] Search returned non-finite score for ${move.from}->${move.to}. Setting to EVAL_LOSE_SCORE.`);
                        scoreForThisMove = EVAL_LOSE_SCORE;
                    } else {
                        scoreForThisMove = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, scoreForThisMove));
                    }
                }
            } catch (e) {
                console.error(`[findBestMoveMinimaxBB D${depth}] Error during simulation or searchBB call for move ${move.from}->${move.to}:`, e);
                if (e instanceof Error) { console.error("Stack:", e.stack); }
                if (isTracedMove) enableTracing = false;
                scoreForThisMove = EVAL_LOSE_SCORE;
            }
        } // end if (!skipSearch)

        if (searchCancelled) {
             evaluatedRootMoves.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.originalIndex - b.originalIndex;
             });
             return { moves: evaluatedRootMoves.length > 0 ? evaluatedRootMoves : null };
        }

        if (!Number.isFinite(scoreForThisMove)) {
            console.error(`[findBestMoveMinimaxBB D${depth}] Score for move ${move.from}->${move.to} became non-finite (${scoreForThisMove}) before storing. Setting to EVAL_LOSE_SCORE.`);
            scoreForThisMove = EVAL_LOSE_SCORE;
        }

        evaluatedRootMoves.push({ move: move, score: scoreForThisMove, originalIndex: i });
        alpha = Math.max(alpha, scoreForThisMove);
        // if (alpha >= beta) { break; }

    } // End root move loop

    // --- Post-Search ---
    evaluatedRootMoves.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.originalIndex - b.originalIndex;
    });

    if (evaluatedRootMoves.length > 0 && evaluatedRootMoves[0].score > (EVAL_LOSE_SCORE + 1)) {
        const bestMoveFound = evaluatedRootMoves[0].move;
        const bestScoreFound = evaluatedRootMoves[0].score;
        let scoreForStorage = bestScoreFound;
        if (scoreForStorage > EVAL_MATE_SCORE_THRESHOLD) scoreForStorage += 0;
        else if (scoreForStorage < EVAL_MATED_SCORE_THRESHOLD) scoreForStorage -= 0;

        const existing = transpositionTable.get(rootHash.toString());
        if (!existing || depth >= existing.depth) {
             if (Number.isFinite(scoreForStorage)) {
                 if (!existing || depth > existing.depth || (depth === existing.depth && (!existing.bestMove || existing.type !== TT_ENTRY_TYPE.EXACT))) {
                      transpositionTable.set(rootHash.toString(), { depth: depth, score: scoreForStorage, type: TT_ENTRY_TYPE.EXACT, bestMove: bestMoveFound });
                 }
             }
        }
    } else if (evaluatedRootMoves.length > 0 && evaluatedRootMoves[0].score <= (EVAL_LOSE_SCORE + 1) && evaluatedRootMoves[0].move) {
        // console.log(`[findBestMoveMinimaxBB D${depth}] Top move ${evaluatedRootMoves[0].move.from}->${evaluatedRootMoves[0].move.to} was penalized at root. Not storing in TT.`); // DEBUG LOG (Commented out)
    } else if (evaluatedRootMoves.length === 0) {
        console.warn(`[findBestMoveMinimaxBB D${depth}] No root moves were successfully evaluated.`);
         return { moves: [{ move: null, score: EVAL_LOSE_SCORE, originalIndex: -1 }] };
    }

    return { moves: evaluatedRootMoves };
}


// --- AI Control Flow ---

/**
 * Controls the AI's move selection using Iterative Deepening (ID) with time management.
 * Initializes search state, calculates time limits, runs the search iteratively,
 * dynamically adjusts depth based on piece count, enforces a minimum search depth,
 * uses a pre-emptive time check, handles results, manages the AI clock,
 * validates the final chosen move *against repetition rules using final hash*, and triggers the chosen move or fallback.
 * Includes check for immediate winning move before starting search.
 * Depends on: initializeAISearchState, findImmediateWinningMove, popcount, getPieceCountsBB,
 *             findBestMoveMinimaxBB, performFallbackMove, isValidMoveBB, getFinalHashAfterMoveBB,
 *             getRestrictedPlayer,
 *             coordToBitIndex (bitboardUtils.js), getPieceTypeIndex (utils.js),
 *             timeLimit, searchStartTime, searchCancelled globals,
 *             PLAYERS, MIN_TIME_PER_MOVE, TIME_USAGE_FACTOR, TIME_PREDICTION_FACTOR,
 *             MAX_SEARCH_DEPTH, OPENING_DEPTH_CAP, MIN_FORCED_DEPTH (constants.js).
 *             Assumes global access to `gameState`, `orangeTime`, `yellowTime`.
 *             Calls UI functions: `performMove` (indirectly via `performMove`), `updateClockDisplay`.
 */
function triggerAIMove() {
    console.log("AI (Yellow) is thinking...");
    const player = PLAYERS.YELLOW;
    const aiPlayerClockTime = yellowTime;

    // --- Initialize Search State ---
    initializeAISearchState();
    transpositionTable.clear(); // Optional: Clear TT at the start of each full move trigger if needed

    // --- Check for Immediate Win ---
    try {
        const immediateWin = findImmediateWinningMove(gameState.bitboards, player, false);
        if (immediateWin) {
            console.log(`AI Found Immediate Winning Move: ${immediateWin.from}->${immediateWin.to}. Performing immediately.`);
            const aiEndTime = performance.now();
            const totalTime = (aiEndTime - searchStartTime);
            const elapsedSeconds = Math.max(0, Math.round(totalTime / 1000));
            yellowTime -= elapsedSeconds;
            if (yellowTime < 0) yellowTime = 0;
            updateClockDisplay(PLAYERS.YELLOW, yellowTime);
            performMove(immediateWin.from, immediateWin.to); // Assumes performMove is globally accessible
            return;
        }
    } catch (winCheckError) {
        console.error("Error during immediate win check:", winCheckError);
    }

    // --- Calculate Time Limit ---
    const positiveClockTime = Math.max(0, aiPlayerClockTime);
    let allocatedTime = Math.max(MIN_TIME_PER_MOVE, positiveClockTime * 1000 * TIME_USAGE_FACTOR);
    // Ensure not using too much time if clock is low, but guarantee minimum time
    allocatedTime = Math.min(allocatedTime, Math.max(MIN_TIME_PER_MOVE, positiveClockTime * 1000 * 0.8));
    if (aiPlayerClockTime <= 0) allocatedTime = MIN_TIME_PER_MOVE; // Fixed time if clock is out
    timeLimit = allocatedTime;
    searchStartTime = performance.now(); // Reset start time just before ID loop

    // --- Calculate Dynamic Depth ---
    const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(gameState.bitboards);
    const totalPieces = orangeCount + yellowCount;
    let calculatedDepth;
    // Adjust depth based on piece count (example ranges, tune as needed)
    if (totalPieces >= 14) { calculatedDepth = OPENING_DEPTH_CAP; } // Early game
    else if (totalPieces >= 10) { calculatedDepth = 10; } // Mid game
    else if (totalPieces >= 6) { calculatedDepth = 10; }  // Late mid game
    else { calculatedDepth = 10; }                       // End game
    let maxDepthForThisSearch = Math.min(calculatedDepth, MAX_SEARCH_DEPTH);
    maxDepthForThisSearch = Math.max(maxDepthForThisSearch, MIN_FORCED_DEPTH); // Ensure minimum depth

    // --- Iterative Deepening Loop ---
    let bestMovesListOverall = [];
    let bestScoreOverall = -Infinity;
    let lastCompletedDepth = 0;
    const rootBitboards = gameState.bitboards; // Use the current actual game state
    const rootHash = gameState.zobristHash;
    const rootGameOver = gameState.gameOver;
    const rootWinner = gameState.winner;
    const playerForMaxID = player;
    // Capture initial hungry state for accurate repetition check simulation
    const initialHungryBBForRepCheck = {
        [PLAYERS.ORANGE]: gameState.hungryBB?.[PLAYERS.ORANGE] ?? BB_EMPTY, // Use nullish coalescing for safety
        [PLAYERS.YELLOW]: gameState.hungryBB?.[PLAYERS.YELLOW] ?? BB_EMPTY
    };

    for (let currentDepth = 1; currentDepth <= maxDepthForThisSearch; currentDepth++) {
        let allowMateScoreStop = currentDepth >= MIN_FORCED_DEPTH; // Only stop early for mates after reaching min depth
        searchCancelled = false; // Reset cancellation flag for each depth iteration

        try {
            const elapsedTimeMs = performance.now() - searchStartTime;
            // Pre-emptive time check: Stop if predicted time exceeds limit significantly
            if (currentDepth > 1 && timeLimit > 0 && elapsedTimeMs > timeLimit * TIME_PREDICTION_FACTOR) {
                // console.log(`ID Depth ${currentDepth}: Pre-emptive time check failed (${elapsedTimeMs.toFixed(0)}ms > ${timeLimit.toFixed(0)}ms * ${TIME_PREDICTION_FACTOR}). Cancelling.`);
                searchCancelled = true;
                break; // Stop deepening
            }

            // Perform the search for the current depth
            const result = findBestMoveMinimaxBB(currentDepth, rootBitboards, playerForMaxID, rootHash, rootGameOver, rootWinner);

            // Check if search was cancelled during execution
            if (searchCancelled) {
                 // console.log(`ID Depth ${currentDepth}: Search cancelled.`);
                 break; // Exit ID loop
            }

            // Process valid results
            if (result && result.moves && result.moves.length > 0) {
                bestMovesListOverall = result.moves; // Store the ordered list from this depth
                bestScoreOverall = result.moves[0].score; // Update overall best score
                lastCompletedDepth = currentDepth; // Mark this depth as successfully completed

                // Optional: Log PV line here if desired
                // console.log(`Depth ${currentDepth} Best Move: ${bestMovesListOverall[0].move?.from}->${bestMovesListOverall[0].move?.to} Score: ${bestScoreOverall.toFixed(1)}`);

                // Check for early exit conditions
                if (allowMateScoreStop && Math.abs(bestScoreOverall) > EVAL_MATE_SCORE_THRESHOLD) {
                    // console.log(`ID Depth ${currentDepth}: Mate score found (${bestScoreOverall.toFixed(1)}). Stopping early.`);
                    break; // Mate found, no need to search deeper
                }
                if (timeLimit > 0 && performance.now() - searchStartTime >= timeLimit) {
                     // console.log(`ID Depth ${currentDepth}: Time limit reached (${(performance.now() - searchStartTime).toFixed(0)}ms >= ${timeLimit.toFixed(0)}ms). Cancelling.`);
                     searchCancelled = true;
                     break; // Time limit reached
                }

            } else if (result && result.moves && result.moves.length === 1 && result.moves[0].move === null) {
                // Handle case where search returns only a null move (stalemate/checkmate)
                bestMovesListOverall = result.moves;
                bestScoreOverall = result.moves[0].score;
                lastCompletedDepth = currentDepth;
                 // console.log(`ID Depth ${currentDepth}: Search returned null move (Stalemate/Checkmate). Score: ${bestScoreOverall.toFixed(1)}`);
                if (allowMateScoreStop && bestScoreOverall < EVAL_MATED_SCORE_THRESHOLD) {
                     break; // Stop if being mated
                }
                if (timeLimit > 0 && performance.now() - searchStartTime >= timeLimit) {
                     searchCancelled = true;
                     break; // Time limit reached
                }

            } else {
                console.warn(`ID Warning: Invalid result object or empty moves list returned from search at depth ${currentDepth}. Using previous depth's result.`);
                break; // Stop deepening if search returned invalid data
            }
        } catch (e) {
            console.error(`>>> ID LOOP CAUGHT ERROR at currentDepth = ${currentDepth} <<<`, e);
            if (e instanceof Error) console.error("Stack:", e.stack);
            searchCancelled = true; // Ensure search stops on error
            break; // Stop deepening
        }
    } // End Iterative Deepening Loop

    // --- Post-Search ---
    const aiEndTime = performance.now();
    const totalTime = (aiEndTime - searchStartTime);
    const totalTimeSec = (totalTime / 1000).toFixed(2);
    console.log(`AI Search Complete. Final Depth: ${lastCompletedDepth}. Nodes: ${nodeCount}, Time: ${totalTimeSec}s`);

    // --- Deduct AI Thinking Time ---
    const elapsedSeconds = Math.max(0, Math.round(totalTime / 1000)); // Use total ID time
    yellowTime -= elapsedSeconds;
    if (yellowTime < 0) yellowTime = 0;
    updateClockDisplay(PLAYERS.YELLOW, yellowTime);
    if (yellowTime <= 0) { console.log("Yellow time ran out AFTER move calculation."); }

    // --- Validate and Perform Move from the best list ---
    let movePerformed = false;
    if (bestMovesListOverall.length > 0 && bestMovesListOverall[0].move !== null) {
        // <<< START DETAILED LOGGING >>>
        console.log(`AI Top Candidate Moves (Depth ${lastCompletedDepth}):`);
        const topN = Math.min(5, bestMovesListOverall.length); // Log top 5 or fewer
        for (let i = 0; i < topN; i++) {
            const evalMove = bestMovesListOverall[i];
            if (evalMove.move) {
                // Log piece type index for clarity
                console.log(`  #${i + 1}: ${evalMove.move.from}->${evalMove.move.to} (Score: ${evalMove.score.toFixed(1)}, PieceType: ${evalMove.move.pieceTypeIndex})`);
            } else {
                console.log(`  #${i + 1}: Null Move (Score: ${evalMove.score.toFixed(1)})`);
            }
        }
        // <<< END DETAILED LOGGING >>>

        console.log(`AI considering moves from depth ${lastCompletedDepth}. Top score: ${bestScoreOverall.toFixed(1)}`);

        // Iterate through the best moves from the *last completed depth*
        for (const evaluatedMove of bestMovesListOverall) {
            const candidateMove = evaluatedMove.move;
            if (!candidateMove || !candidateMove.from || !candidateMove.to || typeof candidateMove.pieceTypeIndex !== 'number') {
                continue; // Skip invalid move objects in the list
            }

            // 1. Basic Validity Check (redundant but safe)
            const fromIdx = coordToBitIndex(candidateMove.from);
            const toIdx = coordToBitIndex(candidateMove.to);
            if (fromIdx === -1 || toIdx === -1) continue;
            // Use current gameState.bitboards for final validation
            const validation = isValidMoveBB(fromIdx, toIdx, candidateMove.pieceTypeIndex, player, gameState.bitboards);
            if (!validation.valid) {
                 console.warn(`AI Warning: Move ${candidateMove.from}->${candidateMove.to} from search list failed basic validation: ${validation.reason}`);
                 continue; // Skip if move is fundamentally illegal in the current state
            }

            // 2. *** Accurate Repetition Check using Final Hash ***
            let isIllegalRepetition = false;
            // Use the helper function to get the hash *after* side effects
            const finalPredictedHash = getFinalHashAfterMoveBB(
                gameState.bitboards,        // Current board state
                player,                     // Player making the move (AI)
                gameState.zobristHash,      // Current hash
                initialHungryBBForRepCheck, // Hungry state *before* the move
                candidateMove               // The move object being considered
            );

            if (finalPredictedHash !== null) {
                const repetitionCount = gameState.boardStateHistory[finalPredictedHash.toString()] || 0;
                if (repetitionCount >= 2) {
                    const { orange: oc, yellow: yc } = getPieceCountsBB(gameState.bitboards); // Use current counts
                    const restrictedPlayer = getRestrictedPlayer(oc, yc);
                    if (player === restrictedPlayer) {
                        isIllegalRepetition = true;
                         console.log(`AI Note: Skipping move ${candidateMove.from}->${candidateMove.to} due to repetition rule (checked final hash).`);
                    }
                }
            } else {
                 // If final hash is null, the move simulation failed (e.g., invalid hungry den entry)
                 console.warn(`AI Note: Skipping move ${candidateMove.from}->${candidateMove.to} because final hash prediction failed.`);
                 continue; // Treat as invalid move
            }
            // --- End Accurate Repetition Check ---


            // 3. If NOT an illegal repetition, perform this move
            if (!isIllegalRepetition) {
                console.log(`AI Performing Move: ${candidateMove.from}->${candidateMove.to} (Score: ${evaluatedMove.score.toFixed(1)}, Depth: ${lastCompletedDepth})`);
                performMove(candidateMove.from, candidateMove.to); // Assumes performMove is globally accessible
                movePerformed = true;
                break; // Exit loop once a valid move is performed
            }
        } // End loop through bestMovesListOverall
    }

    // --- Handle cases where no move was performed ---
    if (!movePerformed) {
        if (bestMovesListOverall.length > 0 && bestMovesListOverall[0].move === null) {
            // Search correctly determined stalemate/checkmate
            console.log("AI Search concluded no valid moves (likely stalemate/checkmate). No move performed.");
             if (!gameState.gameOver) {
                 updateStatus(`Game Over! ${player.toUpperCase()} has no legal moves.`); // Assumes updateStatus is globally accessible
                 gameState.gameOver = true;
                  if(bestScoreOverall < EVAL_MATED_SCORE_THRESHOLD) {
                     // If score indicates being mated, the opponent wins
                     gameState.winner = player === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
                  } else {
                      // Otherwise, it's a stalemate (draw)
                      gameState.winner = null;
                  }
                 disablePlayerInteraction(); // Assumes globally accessible
                 pauseAllClocks(); // Assumes globally accessible
                 updateUndoButtonState(); // Assumes globally accessible
             }
        } else {
            // No valid moves found in the list, or all were illegal repetitions
            console.error(`AI ERROR: No valid move found in search results! (lastCompletedDepth: ${lastCompletedDepth}). Falling back.`);
            performFallbackMove(player); // Assumes globally accessible
        }
    }
}


/**
 * Helper function to perform a fallback move if the main AI search fails or selects an invalid move.
 * Generates all *legal* moves, simulates each, evaluates the resulting board state statically,
 * and performs the move with the best evaluation score.
 * Depends on: getAllValidMovesBB, isValidMoveBB, simulateMoveBB, evaluateBoardBB, coordToBitIndex.
 * Calls UI function `performMove`.
 * @param {string} player - The player whose turn it is (usually the AI).
 */
function performFallbackMove(player) {
    console.warn("Executing AI fallback move logic (evaluating legal moves)...");
    let bestFallbackMove = null;
    let bestFallbackScore = -Infinity; // Initialize to worst score for the player

    try {
        // 1. Get pseudo-legal moves
        const pseudoLegalMoves = getAllValidMovesBB(gameState.bitboards, player, false);
        const currentBitboards = gameState.bitboards; // Use current actual state
        const currentHash = gameState.zobristHash;

        // 2. Iterate and validate/evaluate
        for (const move of pseudoLegalMoves) {
            if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') continue;

            const fromIdx = coordToBitIndex(move.from);
            const toIdx = coordToBitIndex(move.to);
            if (fromIdx === -1 || toIdx === -1) continue;

            // 3. Check if truly legal
            const validation = isValidMoveBB(fromIdx, toIdx, move.pieceTypeIndex, player, currentBitboards);
            if (!validation.valid) {
                continue; // Skip illegal moves
            }

            // 4. Simulate the *legal* move
            const simResult = simulateMoveBB(currentBitboards, player, currentHash, move);
            if (!simResult) {
                // console.warn(`Fallback: Simulation failed for legal move ${move.from}->${move.to}`);
                continue; // Skip if simulation fails unexpectedly
            }
            const { nextBitboards, nextPlayer, nextGameOver, nextWinner } = simResult;

            // 5. Evaluate the resulting board state
            let score;
            if (nextGameOver) {
                if (nextWinner === player) score = EVAL_WIN_SCORE;
                else if (nextWinner === null) score = 0;
                else score = EVAL_LOSE_SCORE;
            } else {
                // Evaluate from the perspective of the player making the move
                score = evaluateBoardBB(nextBitboards, player);
            }

            // 6. Update best fallback move
            if (Number.isFinite(score) && score > bestFallbackScore) {
                bestFallbackScore = score;
                bestFallbackMove = move;
            }
        } // End loop through moves

    } catch (e) {
        console.error("AI Fallback Error during evaluation:", e);
        // Attempt to perform *any* legal move if evaluation fails mid-way
        if (!bestFallbackMove) {
             try {
                 const currentValidMoves = getAllValidMovesBB(gameState.bitboards, player, false)
                                             .filter(m => {
                                                 const f = coordToBitIndex(m.from);
                                                 const t = coordToBitIndex(m.to);
                                                 return f !== -1 && t !== -1 && isValidMoveBB(f, t, m.pieceTypeIndex, player, gameState.bitboards).valid;
                                             });
                 if (currentValidMoves.length > 0) bestFallbackMove = currentValidMoves[0];
             } catch (nestedE) { console.error("AI Nested Fallback Error:", nestedE); }
        }
    }

    // 7. Perform the chosen move or handle no moves found
    if (bestFallbackMove) {
         console.log(`AI Fallback: Performing best evaluated move ${bestFallbackMove.from} -> ${bestFallbackMove.to} (Static Score: ${bestFallbackScore.toFixed(0)})`);
         performMove(bestFallbackMove.from, bestFallbackMove.to); // Assumes performMove exists in main scope
    } else {
        // This means absolutely no *legal* moves are possible
        console.error("AI CRITICAL FALLBACK ERROR: No legal moves available!");
        if (!gameState.gameOver) {
             updateStatus(`Game Over! ${player.toUpperCase()} has no legal moves.`);
             gameState.gameOver = true;
             // Determine winner based on who has no moves
             gameState.winner = player === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
             disablePlayerInteraction();
             pauseAllClocks();
             updateUndoButtonState();
        }
    }
}

// --- Export (if using modules) ---
// export { triggerAIMove, evaluateBoardBB, ... };
