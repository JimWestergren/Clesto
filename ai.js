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
 * Static Evaluation Function using Bitboards (V11.4 - Added Unanswered Den Threat).
 * Evaluates based on Material, Den Proximity (with extreme penalty/bonus for immediate threats),
 * positional masks, basic safety checks (using attack maps), and hungry penalties/bonuses.
 * Relies on `generateAttackMapsBB` for accurate threat detection.
 * Depends on: BB_IDX, EVAL_*, PLAYERS, DENS, TRAPS (constants.js),
 *             popcount, getBit, lsbIndex, bitIndexToCoord, coordToBitIndex, allTrapsBB, waterBB (bitboardUtils.js),
 *             generateAttackMapsBB (bitboardUtils.js),
 *             getPieceData (gameState.js), getRowCol (utils.js), getAllValidMovesBB (gameLogic.js),
 *             gameState (for hungryBB).
 *             Global bitboard state from bitboardUtils.js (centerColsBB, orangeAdvanceBB, etc.).
 *
 * @param {bigint[]} bitboards - The bitboard array state.
 * @param {string} playerForMax - The player considered "maximizing" (the perspective for the returned score).
 * @returns {number} A numerical score. Higher is better for playerForMax. Clamped.
 */
function evaluateBoardBB(bitboards, playerForMax) {
    // --- Evaluation Terms ---
    // (+) Material
    // (+) Center Control
    // (+) Advancement
    // (+) Den Proximity (Non-hungry pieces near opponent den)
    // (+) Safe Den Attack: HUGE bonus if piece adjacent to opponent den AND cannot be captured.
    // (+) Threatening Opponent Pieces
    // (+) Opponent Hungry
    // (+) Water Control
    // (-) Threatened Pieces (includes undefended penalty)
    // (-) Opponent Water Control
    // (-) Own Den Proximity (Opponent pieces near own den)
    // (-) Unanswered Den Threat: HUGE penalty if opponent adjacent to own den AND cannot be captured.
    // (-) Own Hungry Pieces
    // (-) Immediate Losing Capture Penalty
    // (-) Immediate Trap Doom Penalty

    let score = 0;
    const fnName = "evaluateBoardBB";

    // --- Basic Validation ---
    if (!bitboards || bitboards.length !== BB_IDX.COUNT || (playerForMax !== PLAYERS.ORANGE && playerForMax !== PLAYERS.YELLOW)) {
        console.error(`[${fnName} Error] Invalid bitboards array or playerForMax provided.`);
        return EVAL_LOSE_SCORE + 10;
    }

    const opponent = playerForMax === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const maxDenCoord = DENS[playerForMax]; // Player's own den
    const minDenCoord = DENS[opponent]; // Opponent's den
    const maxTrapsBB = playerForMax === PLAYERS.ORANGE ? yellowTrapBB : orangeTrapBB; // Traps affecting opponent

    const maxHungryBB = gameState.hungryBB?.[playerForMax] ?? BB_EMPTY;
    const minHungryBB = gameState.hungryBB?.[opponent] ?? BB_EMPTY;

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
        const maxDenIdx = coordToBitIndex(maxDenCoord); // Player's den index
        const minDenIdx = coordToBitIndex(minDenCoord); // Opponent's den index

        if (minDenIdx === -1 || maxDenIdx === -1) {
            console.error(`[${fnName} Error] Invalid Den coordinates.`);
            return 0; // Cannot evaluate without dens
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

                // Check immediate win/loss by non-hungry piece entering den
                if (lsb === minDenIdx && player === playerForMax && !isHungry) { return EVAL_WIN_SCORE; }
                if (lsb === maxDenIdx && player === opponent && !isHungry) { return EVAL_LOSE_SCORE; }

                const coords = bitIndexToCoord(lsb);
                if (!coords) { tempBB = clearBit(tempBB, lsb); continue; }
                const rc = getRowCol(coords);
                if (!rc) { tempBB = clearBit(tempBB, lsb); continue; }

                piecesData[player][coords] = { rank: rank, rc: rc, isHungry: isHungry, index: lsb }; // Store index too

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

    // --- Evaluate Threats/Safety & Trap Doom ---
    // (Logic from previous step - checking losing captures, trap doom, standard threats)
    try {
        let totalThreatPenalty = 0;
        let isPlayerForMaxDoomedOnTrap = false;

        // Iterate through playerForMax's pieces to check their safety
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
                 const isOnTrap = getBit(maxTrapsBB, myIndex) !== 0n; // Is my piece on a trap that affects opponent? (Incorrect check here, should be trap affecting ME)
                 // Correction: Check trap affecting playerForMax
                 const playerTrapBB = playerForMax === PLAYERS.ORANGE ? orangeTrapBB : yellowTrapBB;
                 const isOnMyTrap = getBit(playerTrapBB, myIndex) !== 0n;

                 let opponentValidMoves = null; // Lazy generation
                 const getOpponentMoves = () => {
                     if (opponentValidMoves === null) {
                         opponentValidMoves = getAllValidMovesBB(bitboards, opponent, true);
                     }
                     return opponentValidMoves;
                 };

                 // A. Check for immediate *losing* captures
                 for (const oppMove of getOpponentMoves()) {
                     if (oppMove.to === myCoords) {
                         const attackerRank = (oppMove.pieceTypeIndex % 8) + 1;
                         const isRatVsElephant = (attackerRank === 1 && myRank === 8);
                         const isElephantVsRat = (attackerRank === 8 && myRank === 1);
                         const attackerWinsRank = attackerRank >= myRank;

                         const oppFromIdx = coordToBitIndex(oppMove.from);
                         if (oppFromIdx === -1) continue;
                         const captureValidation = isValidMoveBB(oppFromIdx, myIndex, oppMove.pieceTypeIndex, opponent, bitboards);

                         if (captureValidation.valid && !isRatVsElephant && (attackerWinsRank || isElephantVsRat)) {
                             score -= myValue * 1.8;
                             isLosingCaptureImminent = true;
                             break;
                         }
                     }
                 }

                 // B. Check for immediate trap doom
                 // Corrected: Check if piece is on a trap that makes *it* weak (playerTrapBB)
                 if (!isLosingCaptureImminent && isOnMyTrap) { // Use isOnMyTrap
                      for (const oppMove of getOpponentMoves()) {
                          if (oppMove.to === myCoords) {
                              const attackerRank = (oppMove.pieceTypeIndex % 8) + 1;
                              const oppFromIdx = coordToBitIndex(oppMove.from);
                              if (oppFromIdx === -1) continue;
                              const trapCaptureValidation = isValidMoveBB(oppFromIdx, myIndex, oppMove.pieceTypeIndex, opponent, bitboards);

                              // Doom requires valid capture by a *strictly lower* original rank attacker
                              if (trapCaptureValidation.valid && attackerRank < myRank) {
                                   score += EVAL_IMMEDIATE_TRAP_DOOM_PENALTY;
                                   isDoomedOnTrap = true;
                                   isPlayerForMaxDoomedOnTrap = true;
                                   break;
                              }
                          }
                      }
                 }

                 // C. Apply standard threat penalties
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

        // Attacks made by playerForMax: Bonus for threatening opponent pieces
        let totalAttackingBonus = 0;
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

    } catch (e) { console.error(`[${fnName} Error] During threat/trap check:`, e); }


    // --- Evaluate Positional Factors (Center, Advancement, Den Proximity) ---
    try {
        const maxPlayerBB = bitboards[playerForMax === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES];
        const playerAdvanceBB = playerForMax === PLAYERS.ORANGE ? orangeAdvanceBB : yellowAdvanceBB;

        // Center Control & Advancement Bonuses
        score += popcount(maxPlayerBB & centerColsBB) * EVAL_CENTER_BONUS;
        score += popcount(maxPlayerBB & playerAdvanceBB) * EVAL_ADVANCE_BONUS;

        const minDenRC = getRowCol(minDenCoord); // Opponent's den location
        const maxDenRC = getRowCol(maxDenCoord); // Player's den location

        // Den Proximity Checks (including immediate threats)
        if (minDenRC) { // Evaluating player's proximity to opponent's den
             for (const coords in piecesData[playerForMax]) {
                 if (!Object.prototype.hasOwnProperty.call(piecesData[playerForMax], coords)) continue;
                 const item = piecesData[playerForMax][coords];
                 if (!item || !item.rank || !item.rc || !item.hasOwnProperty('isHungry') || typeof item.index === 'undefined') continue;
                 const pieceValue = EVAL_PIECE_VALUES[item.rank] || 0;
                 const pieceIndex = item.index;
                 const dist = Math.abs(item.rc.row - minDenRC.row) + Math.abs(item.rc.col - minDenRC.col);

                 if (!item.isHungry) { // Only non-hungry pieces score for den proximity/attack
                      if (dist === 1) { // Adjacent
                           // HUGE bonus if the opponent CANNOT capture this adjacent piece
                           const isSafe = getBit(opponentAttackMapBB, pieceIndex) === 0n;
                           if (isSafe) {
                               score += EVAL_SAFE_DEN_ATTACK_BONUS;
                           } else {
                               // Normal adjacent bonus (scaled)
                               score += EVAL_DEN_ADJACENT_BASE_BONUS * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                           }
                      } else if (dist === 2) { // Nearby
                           score += EVAL_DEN_NEAR_BASE_BONUS * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                      }
                 }
             }
        }

        if (maxDenRC) { // Evaluating opponent's proximity to player's den
             for (const coords in piecesData[opponent]) {
                  if (!Object.prototype.hasOwnProperty.call(piecesData[opponent], coords)) continue;
                  const item = piecesData[opponent][coords];
                  if (!item || !item.rank || !item.rc || !item.hasOwnProperty('isHungry') || typeof item.index === 'undefined') continue;
                  const pieceValue = EVAL_PIECE_VALUES[item.rank] || 0;
                  const pieceIndex = item.index;
                  const dist = Math.abs(item.rc.row - maxDenRC.row) + Math.abs(item.rc.col - maxDenRC.col);

                  // Opponent doesn't need to be non-hungry to be a threat
                  if (dist === 1) { // Adjacent
                      // HUGE penalty if player CANNOT capture this adjacent opponent piece
                      const isThreatUnanswered = getBit(playerAttackMapBB, pieceIndex) === 0n;
                      if (isThreatUnanswered) {
                           score += EVAL_UNANSWERED_DEN_THREAT_PENALTY;
                      } else {
                           // Normal adjacent penalty (scaled)
                           score += EVAL_OPP_DEN_ADJACENT_BASE_PENALTY * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                      }
                  } else if (dist === 2) { // Nearby
                      score += EVAL_OPP_DEN_NEAR_BASE_PENALTY * (1 + (DEN_PROXIMITY_RANK_SCALE_FACTOR * (pieceValue / 100)));
                  }
             }
        }
    } catch (e) { console.error(`[${fnName} Error] During positional check:`, e); }

    // --- Evaluate Water Control ---
    // (Same as before)
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
    } catch(e) { console.error(`[${fnName} Error] During water control check:`, e); }

    // --- Hungry State Evaluation ---
    // (Same as before)
    const maxHungryCount = popcount(maxHungryBB);
    const minHungryCount = popcount(minHungryBB);
    if (minHungryCount > 1) score += EVAL_MULTI_HUNGRY_BONUS;
    if (maxHungryCount > 1) score -= (EVAL_MULTI_HUNGRY_BONUS * 2);
    else if (maxHungryCount === 1) score += EVAL_SINGLE_HUNGRY_PENALTY;

    // --- Final Clamping and Return ---
    if (!Number.isFinite(score)) {
        console.warn(`[${fnName} Warn] Score non-finite (${score}) before clamp. Resetting.`);
        score = 0;
    }
    const finalScore = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, score));
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
 * Depends on: nodeCount, searchCancelled, timeLimit, searchStartTime globals,
 *             transpositionTable global (reads), gameState.boardStateHistory global (reads),
 *             MAX_SEARCH_DEPTH, MAX_QUIESCENCE_DEPTH, EVAL_WIN_SCORE, EVAL_LOSE_SCORE,
 *             EVAL_MATED_SCORE_THRESHOLD, TT_ENTRY_TYPE, BB_IDX, PLAYERS (constants.js),
 *             evaluateBoardBB, getAllValidMovesBB, simulateMoveBB, isValidMoveBB (gameLogic.js),
 *             getPieceCountsBB, getRestrictedPlayer, coordToBitIndex, getBit (bitboardUtils.js).
 *
 * @param {bigint[]} bitboards - Current bitboard state.
 * @param {string} currentPlayer - Player whose turn it is.
 * @param {bigint} currentHash - Zobrist hash of this state.
 * @param {number} alpha - Lower bound for currentPlayer.
 * @param {number} beta - Upper bound for currentPlayer.
 * @param {number} ply - Current total search depth from the root (0 at root).
 * @returns {number} Evaluated score for the stable position, relative to currentPlayer. Clamped.
 */
function qsearchBB(bitboards, currentPlayer, currentHash, alpha, beta, ply) {
    nodeCount++;

    // --- Time & Cancellation Checks ---
    if (searchCancelled || (timeLimit > 0 && (nodeCount & 1023) === 0 && performance.now() - searchStartTime > timeLimit)) {
        if (!searchCancelled) { searchCancelled = true; /*console.log("QSearch cancelled by time.");*/ }
        return 0; // Return neutral on cancel
    }
    if (searchCancelled) return 0; // Already cancelled

    // --- Max Depth Check ---
    if (ply >= MAX_SEARCH_DEPTH + MAX_QUIESCENCE_DEPTH) {
        try {
            let evalScore = evaluateBoardBB(bitboards, currentPlayer); // Use current player's perspective
            return Number.isFinite(evalScore) ? Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, evalScore)) : 0;
        } catch (e) { console.error(`[QSearchBB MaxDepth Eval Error] P${ply}:`, e); return 0; }
    }

    // --- Repetition Check ---
    const hashKey = currentHash.toString();
    const repetitionCount = gameState.boardStateHistory[hashKey] || 0;
    if (repetitionCount >= 2 && ply > 0) {
        const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(bitboards);
        const restrictedPlayerAtNode = getRestrictedPlayer(orangeCount, yellowCount);
        if (currentPlayer === restrictedPlayerAtNode) {
            return 0; // Draw score by rule
        }
    }

    // --- Stand-Pat Score ---
    let standPatScore;
    try {
        standPatScore = evaluateBoardBB(bitboards, currentPlayer);
        standPatScore = Number.isFinite(standPatScore) ? standPatScore : EVAL_LOSE_SCORE;
        standPatScore = Math.max(EVAL_LOSE_SCORE, Math.min(EVAL_WIN_SCORE, standPatScore));
    } catch (e) {
        console.error(`[QSearchBB Eval Error] P${ply}:`, e);
        standPatScore = EVAL_LOSE_SCORE;
    }

    // --- Stand-Pat Pruning ---
    if (standPatScore >= beta) {
        return beta; // Fail-hard beta cutoff
    }
    alpha = Math.max(alpha, standPatScore);

    // --- Generate & VALIDATE Noisy Moves (Captures Only) ---
    let noisyMoves = [];
    try {
        const allPseudoMoves = getAllValidMovesBB(bitboards, currentPlayer, true);
        const opponentBBIndex = currentPlayer === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
        const opponentPiecesBB = bitboards[opponentBBIndex];

        for (const move of allPseudoMoves) {
            if (!move || !move.to || typeof move.pieceTypeIndex !== 'number') continue;
            const toIndex = coordToBitIndex(move.to);

            // Check if it targets an opponent piece
            if (toIndex !== -1 && getBit(opponentPiecesBB, toIndex) !== 0n) {
                // --- ADD VALIDATION STEP FOR CAPTURE ---
                const fromIndex = coordToBitIndex(move.from);
                if (fromIndex !== -1) {
                    const validation = isValidMoveBB(fromIndex, toIndex, move.pieceTypeIndex, currentPlayer, bitboards);
                    if (validation.valid) {
                        noisyMoves.push(move); // Only add fully valid captures
                    }
                }
                // ---------------------------------------
            }
        }
        // Order valid capture moves
        if (noisyMoves.length > 1) {
            noisyMoves = getOrderedMovesBB(bitboards, null, ply, noisyMoves, currentPlayer);
        }

    } catch (e) {
        console.error(`[QSearchBB Error] Error generating/validating noisy moves at ply ${ply}:`, e);
        // Fall through and return standPatScore if move generation/validation fails
    }

    // --- Base Case: No Valid Captures or Error ---
    if (noisyMoves.length === 0) {
        return standPatScore;
    }

    // --- Explore Valid Captures ---
    let bestScore = standPatScore;

    for (const move of noisyMoves) { // Iterate through VALID capture moves only
        // Simulate the valid capture move
        const simResult = simulateMoveBB(bitboards, currentPlayer, currentHash, move);
        if (!simResult) {
            // console.warn(`[QSearchBB Warn] Simulation failed for VALID capture ${move.from}->${move.to} at ply ${ply}`);
            continue; // Skip this move if simulation failed
        }
        const { nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner } = simResult;

        // --- Manage History for Recursion ---
        const nextHashKey = nextHash.toString();
        gameState.boardStateHistory[nextHashKey] = (gameState.boardStateHistory[nextHashKey] || 0) + 1;

        let score;
        if (nextGameOver) {
            if (nextWinner === currentPlayer) score = EVAL_WIN_SCORE - (ply + 1);
            else if (nextWinner === null) score = 0;
            else score = EVAL_LOSE_SCORE + (ply + 1);
        } else {
            score = -qsearchBB(nextBitboards, nextPlayer, nextHash, -beta, -alpha, ply + 1);
        }

        // --- Restore History ---
        gameState.boardStateHistory[nextHashKey]--;
        if (gameState.boardStateHistory[nextHashKey] <= 0) {
            delete gameState.boardStateHistory[nextHashKey];
        }

        if (searchCancelled) return 0;

        score = Number.isFinite(score) ? score : EVAL_LOSE_SCORE;
        bestScore = Math.max(bestScore, score);
        alpha = Math.max(alpha, bestScore);

        if (alpha >= beta) {
            return beta; // Fail-hard beta cutoff
        }
    }

    return bestScore;
}


/**
 * Negamax search function using Bitboards with Alpha-Beta Pruning, TT, Killers, History, NMP, LMR, FP.
 * Generates moves ONCE per node. Calls evaluateBoardBB and qsearchBB.
 * Handles repetition check dynamically within the search loop.
 * Validates captures and hungry den entries before exploring.
 * Depends on: nodeCount, searchCancelled, timeLimit, searchStartTime, killerMoves, historyHeuristic globals,
 *             transpositionTable global (read/write), gameState.boardStateHistory global (read/write),
 *             MAX_SEARCH_DEPTH, EVAL_*, TT_ENTRY_TYPE, NMP_*, LMR_*, FP_*, BB_IDX, PLAYERS (constants.js),
 *             qsearchBB, evaluateBoardBB, getAllValidMovesBB, simulateMoveBB, getOrderedMovesBB,
 *             isValidMoveBB (gameLogic.js),
 *             addKillerMove, updateHistoryScore, getPieceCountsBB, getRestrictedPlayer,
 *             coordToBitIndex, getBit, toggleTurnKey, orangeDenBB, yellowDenBB (bitboardUtils.js/gameState.js). // Added den BBs
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
 * @returns {number} Evaluated score relative to the currentPlayer. Finite & Clamped.
 */
function searchBB(depth, bitboards, currentPlayer, currentHash, isGameOver, winner, alpha, beta, playerForMax, ply, canNullMove = true, inCheck = false) {
    nodeCount++;
    const nodePlayer = currentPlayer;
    const originalAlpha = alpha;
    const hashKey = currentHash.toString();

    // --- Time & Cancellation Checks ---
    if (searchCancelled || (timeLimit > 0 && (nodeCount & 2047) === 0 && performance.now() - searchStartTime > timeLimit)) {
        if (!searchCancelled) { searchCancelled = true; }
        return 0;
    }
    if (searchCancelled) return 0;

    // --- Repetition Check ---
    const repetitionCount = gameState.boardStateHistory[hashKey] || 0;
    if (repetitionCount >= 2 && ply > 0) {
        const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(bitboards);
        const restrictedPlayerAtNode = getRestrictedPlayer(orangeCount, yellowCount);
        if (nodePlayer === restrictedPlayerAtNode) { return 0; }
    }

    // --- Game Over Check ---
    if (isGameOver) {
        let score = 0;
        if (winner === nodePlayer) score = EVAL_WIN_SCORE - ply;
        else if (winner === null) score = 0;
        else score = EVAL_LOSE_SCORE + ply;
        return score;
    }

    // --- Max Depth Check -> Quiescence Search ---
    if (depth <= 0) {
        return qsearchBB(bitboards, nodePlayer, currentHash, alpha, beta, ply);
    }

    // --- Transposition Table Lookup ---
    let ttBestMove = null;
    const ttEntry = transpositionTable.get(hashKey);
    if (ttEntry && ttEntry.depth >= depth) {
        let ttScore = ttEntry.score;
        if (ttScore > EVAL_MATE_SCORE_THRESHOLD) ttScore -= ply;
        else if (ttScore < EVAL_MATED_SCORE_THRESHOLD) ttScore += ply;
        const ttType = ttEntry.type;
        if (ttType === TT_ENTRY_TYPE.EXACT && Number.isFinite(ttScore)) { return Math.max(EVAL_LOSE_SCORE - ply, Math.min(EVAL_WIN_SCORE + ply, ttScore)); }
        if (ttType === TT_ENTRY_TYPE.LOWER_BOUND && ttScore >= beta) { return Math.max(EVAL_LOSE_SCORE - ply, Math.min(EVAL_WIN_SCORE + ply, ttScore)); }
        if (ttType === TT_ENTRY_TYPE.UPPER_BOUND && ttScore <= alpha) { return Math.max(EVAL_LOSE_SCORE - ply, Math.min(EVAL_WIN_SCORE + ply, ttScore)); }
        if (ttEntry.bestMove) ttBestMove = ttEntry.bestMove;
    }

    // --- Null Move Pruning (NMP) & Futility Pruning Prep ---
    let staticEval = -Infinity;
    let didStaticEval = false;
    const needsStaticEval = (canNullMove && depth >= NMP_MIN_DEPTH && ply > 0 && !inCheck) || (depth <= FP_MAX_DEPTH && !inCheck);
    if (needsStaticEval) {
        try { staticEval = evaluateBoardBB(bitboards, nodePlayer); didStaticEval = true; }
        catch (e) { console.error(`[SearchBB Eval Err] P${ply} D${depth}:`, e); staticEval = EVAL_LOSE_SCORE; didStaticEval = true; }
    }
    const canTryNMP = canNullMove && depth >= NMP_MIN_DEPTH && ply > 0 && !inCheck && didStaticEval && staticEval >= beta;
    if (canTryNMP) {
        const nextPlayerNMP = nodePlayer === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
        const nextHashNMP = toggleTurnKey(currentHash);
        const reduction = NMP_REDUCTION;
        const nmpHashKey = nextHashNMP.toString();
        gameState.boardStateHistory[nmpHashKey] = (gameState.boardStateHistory[nmpHashKey] || 0) + 1;
        const nullScore = -searchBB(depth - 1 - reduction, bitboards, nextPlayerNMP, nextHashNMP, false, null, -beta, -beta + 1, playerForMax, ply + 1, false, false);
        gameState.boardStateHistory[nmpHashKey]--;
        if (gameState.boardStateHistory[nmpHashKey] <= 0) { delete gameState.boardStateHistory[nmpHashKey]; }
        if (searchCancelled) return 0;
        if (nullScore >= beta) {
            let scoreToStore = beta;
            if (scoreToStore > EVAL_MATE_SCORE_THRESHOLD) scoreToStore += ply; else if (scoreToStore < EVAL_MATED_SCORE_THRESHOLD) scoreToStore -= ply;
            const existing = transpositionTable.get(hashKey);
            if (!existing || depth >= existing.depth) {
                 if(Number.isFinite(scoreToStore)) { transpositionTable.set(hashKey, { depth: depth, score: scoreToStore, type: TT_ENTRY_TYPE.LOWER_BOUND, bestMove: null }); }
            }
            return beta;
        }
    }

    // --- Generate & Order Moves ---
    let movesToConsider = [];
    try {
        const initialPossibleMoves = getAllValidMovesBB(bitboards, nodePlayer, true);
        if (initialPossibleMoves.length === 0) { return 0; } // Stalemate
        movesToConsider = initialPossibleMoves;
        movesToConsider = getOrderedMovesBB(bitboards, ttBestMove, ply, movesToConsider, nodePlayer);
    } catch (e) { console.error(`[SearchBB Error P${ply} D${depth}] Error getting/ordering moves:`, e); return EVAL_LOSE_SCORE + ply; }

    // --- Search Moves Loop ---
    let bestScore = -Infinity;
    let bestMoveFound = null;
    let movesSearched = 0;

    for (const move of movesToConsider) {
        if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') continue;
        movesSearched++;

        const fromIndex = coordToBitIndex(move.from);
        const toIndex = coordToBitIndex(move.to);
        if (fromIndex === -1 || toIndex === -1) continue;

        // 1. Check basic validity first
        const validation = isValidMoveBB(fromIndex, toIndex, move.pieceTypeIndex, nodePlayer, bitboards);
        if (!validation.valid) {
            continue; // Skip illegal move
        }

        // --- Simulate VALID Move ---
        const simResult = simulateMoveBB(bitboards, nodePlayer, currentHash, move);
        if (!simResult) { continue; }
        const { nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, capturedPieceTypeIndex } = simResult;

        // --- Manage Repetition History ---
        const nextHashKey = nextHash.toString();
        gameState.boardStateHistory[nextHashKey] = (gameState.boardStateHistory[nextHashKey] || 0) + 1;

        // --- Determine if Noisy (for LMR/FP) ---
        const isCapture = capturedPieceTypeIndex !== null;
        const isNoisy = isCapture;

        // --- Futility Pruning ---
        let skipMove = false;
        if (!isNoisy && !inCheck && depth <= FP_MAX_DEPTH && didStaticEval) {
            const futilityMargin = FP_MARGIN_PER_DEPTH * depth;
            if (staticEval + futilityMargin <= alpha) {
                skipMove = true;
            }
        }

        let score = -Infinity;
        if (!skipMove) {
            // --- LMR ---
            let reduction = 0;
            if (depth >= LMR_MIN_DEPTH && movesSearched > LMR_MOVE_COUNT_THRESHOLD && !isNoisy && !inCheck) {
                reduction = LMR_BASE_REDUCTION;
            }

            // --- PVS / Recursive Call ---
            let searchDepth = depth - 1 - reduction;
            if (movesSearched === 1) {
                score = -searchBB(searchDepth, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, ply + 1, true, false);
            } else {
                score = -searchBB(searchDepth, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -alpha - 1, -alpha, playerForMax, ply + 1, true, false);
                if (!searchCancelled && score > alpha && score < beta && reduction === 0) {
                    score = -searchBB(searchDepth, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, ply + 1, true, false);
                }
            }

            // --- LMR Re-search ---
            if (reduction > 0 && score > alpha && !searchCancelled) {
                 score = -searchBB(depth - 1, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, ply + 1, true, false);
            }
        } // End if(!skipMove)

        // --- Restore Repetition History ---
        gameState.boardStateHistory[nextHashKey]--;
        if (gameState.boardStateHistory[nextHashKey] <= 0) {
            delete gameState.boardStateHistory[nextHashKey];
        }

        // --- Check Cancellation & Process Score ---
        if (searchCancelled) return 0;
        if (!Number.isFinite(score)) { score = EVAL_LOSE_SCORE + ply + 1; }

        // --- Update Best Score & Alpha ---
        if (score > bestScore) {
            bestScore = score;
            bestMoveFound = move;
            alpha = Math.max(alpha, bestScore);
        }

        // --- Beta Cutoff ---
        if (alpha >= beta) {
            if (!isCapture && bestMoveFound) {
                addKillerMove(ply, bestMoveFound);
                const toSquareIndexHist = coordToBitIndex(bestMoveFound.to);
                if (toSquareIndexHist !== -1) {
                     updateHistoryScore(bestMoveFound.pieceTypeIndex, toSquareIndexHist, depth * depth);
                }
            }
            let scoreToStore = beta;
            if (scoreToStore > EVAL_MATE_SCORE_THRESHOLD) scoreToStore += ply; else if (scoreToStore < EVAL_MATED_SCORE_THRESHOLD) scoreToStore -= ply;
            const existing = transpositionTable.get(hashKey);
            if (!existing || depth >= existing.depth) {
                 if(Number.isFinite(scoreToStore)) {
                     transpositionTable.set(hashKey, { depth: depth, score: scoreToStore, type: TT_ENTRY_TYPE.LOWER_BOUND, bestMove: bestMoveFound });
                 }
            }
            return beta;
        }
    } // End of move loop

    // --- After All Moves Searched ---
    if (searchCancelled) return 0;
    if (bestScore === -Infinity && movesToConsider.length > 0) { bestScore = originalAlpha; }
    else if (bestScore === -Infinity && movesToConsider.length === 0) { bestScore = 0; }

    // --- Store TT Entry ---
    let entryType = (bestScore <= originalAlpha) ? TT_ENTRY_TYPE.UPPER_BOUND : TT_ENTRY_TYPE.EXACT;
    let scoreForStorage = bestScore;
    if (scoreForStorage > EVAL_MATE_SCORE_THRESHOLD) scoreForStorage += ply; else if (scoreForStorage < EVAL_MATED_SCORE_THRESHOLD) scoreForStorage -= ply;
    const existing = transpositionTable.get(hashKey);
    if (!existing || depth > existing.depth || (depth === existing.depth && entryType === TT_ENTRY_TYPE.EXACT)) {
        if (Number.isFinite(scoreForStorage)) {
             transpositionTable.set(hashKey, { depth: depth, score: scoreForStorage, type: entryType, bestMove: bestMoveFound });
        }
    }

    // --- Return final best score ---
    bestScore = Math.max(EVAL_LOSE_SCORE + ply, Math.min(EVAL_WIN_SCORE - ply, bestScore));
    if (!Number.isFinite(bestScore)) bestScore = 0;
    return bestScore;
}


/**
 * Finds the best move for the AI at the root of the search using Bitboards.
 * Uses the Negamax search function (`searchBB`) internally.
 * Handles potentially large scores, clamping, and non-finite scores.
 * Includes check for immediate wins before starting search.
 * Returns an ordered list of evaluated root moves.
 * Depends on: transpositionTable global (write), EVAL_WIN_SCORE, EVAL_LOSE_SCORE,
 *             EVAL_MATED_SCORE_THRESHOLD, TT_ENTRY_TYPE (constants.js), searchBB, simulateMoveBB,
 *             getAllValidMovesBB, getOrderedMovesBB, findImmediateWinningMove, evaluateBoardBB.
 *
 * @param {number} depth - The maximum search depth for this iteration.
 * @param {bigint[]} rootBitboards - The starting bitboard state.
 * @param {string} playerForMax - The player the AI is playing as (usually YELLOW).
 * @param {bigint} rootHash - The Zobrist hash of the root state.
 * @param {boolean} rootGameOver - Is the game already over at the root?
 * @param {string|null} rootWinner - Who won if game is over?
 * @returns {{moves: Array<{move: object|null, score: number}>}|null} A list of root moves ordered by score (best first), or null on critical error.
 *          Returns { moves: [{ move: null, score: number }] } if game over or stalemate detected at root.
 */
function findBestMoveMinimaxBB(depth, rootBitboards, playerForMax, rootHash, rootGameOver, rootWinner) {
    let evaluatedRootMoves = []; // Store { move, score } pairs
    let alpha = -Infinity;
    let beta = Infinity;

    // --- Initial Validation & Game Over Check ---
    if (!rootBitboards || typeof rootHash !== 'bigint') {
        console.error("[findBestMoveMinimaxBB Error] Invalid root state provided.");
        return null;
    }
    if (rootGameOver) {
        let score = 0; // Default draw
        if (rootWinner === playerForMax) score = EVAL_WIN_SCORE;
        else if (rootWinner !== null) score = EVAL_LOSE_SCORE;
        return { moves: [{ move: null, score: score }] }; // No move to make
    }

    // --- Get and Order Root Moves ---
    let possibleMoves = [];
    try {
        possibleMoves = getAllValidMovesBB(rootBitboards, playerForMax, true); // Use simulation flag
        if (possibleMoves.length === 0) {
            // Stalemate or Checkmate at the root
            return { moves: [{ move: null, score: EVAL_MATED_SCORE_THRESHOLD }] };
        }
        // Order moves using TT hint from previous iterations if available
        const rootTTEntry = transpositionTable.get(rootHash.toString());
        const ttBestMoveHint = rootTTEntry?.bestMove || null;
        possibleMoves = getOrderedMovesBB(rootBitboards, ttBestMoveHint, 0, possibleMoves, playerForMax); // Ply 0 at root

    } catch (e) {
        console.error(`[findBestMoveMinimaxBB D${depth}] Error getting/ordering root moves:`, e);
        return null; // Cannot proceed without moves
    }

    // --- Evaluate Each Root Move ---
    for (let i = 0; i < possibleMoves.length; i++) {
        const move = possibleMoves[i];
        if (!move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number') continue;

        let scoreForThisMove;
        let isTracedMove = enableTracing && move.from === TRACE_MOVE.from && move.to === TRACE_MOVE.to;

        try {
            // Simulate the move
            const simResult = simulateMoveBB(rootBitboards, playerForMax, rootHash, move);
            if (!simResult) {
                // console.log(`[findBestMoveMinimaxBB D${depth}] Simulation returned null for move ${move.from}->${move.to} (illegal move pruned).`);
                scoreForThisMove = EVAL_LOSE_SCORE - 1; // Assign very low score for pruned illegal moves
            } else {
                const { nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner } = simResult;

                // --- Manage History ---
                 const nextHashKey = nextHash.toString();
                 gameState.boardStateHistory[nextHashKey] = (gameState.boardStateHistory[nextHashKey] || 0) + 1;

                const originalTraceState = enableTracing;
                if (isTracedMove) {
                    console.log(`[Trace ${move.from}->${move.to} D${depth}] ---> Calling searchBB(${depth - 1}, ..., ply=1)`);
                    enableTracing = true;
                }

                // Call the recursive search (Negamax)
                scoreForThisMove = -searchBB(depth - 1, nextBitboards, nextPlayer, nextHash, nextGameOver, nextWinner, -beta, -alpha, playerForMax, 1);

                // --- Restore History ---
                 gameState.boardStateHistory[nextHashKey]--;
                 if (gameState.boardStateHistory[nextHashKey] <= 0) {
                     delete gameState.boardStateHistory[nextHashKey];
                 }

                if (isTracedMove) {
                    enableTracing = originalTraceState;
                }

                if (!Number.isFinite(scoreForThisMove)) {
                    scoreForThisMove = EVAL_LOSE_SCORE;
                }
            }

        } catch (e) { // Catch errors specifically from simulate or search call
            console.error(`[findBestMoveMinimaxBB D${depth}] Error during simulation or searchBB call for move ${move.from}->${move.to}:`, e);
            if (e instanceof Error) { console.error("Stack:", e.stack); }
            if (isTracedMove) enableTracing = false;
            scoreForThisMove = EVAL_LOSE_SCORE;
        }

        // Check for Cancellation AFTER the search call returns
        if (searchCancelled) {
             // If cancelled, return the moves evaluated *so far*, ordered.
             evaluatedRootMoves.sort((a, b) => b.score - a.score); // Sort what we have
             return { moves: evaluatedRootMoves.length > 0 ? evaluatedRootMoves : null }; // Return sorted list or null if none evaluated
        }

        // Store the evaluated move and its score
        evaluatedRootMoves.push({ move: move, score: scoreForThisMove });

        // Update alpha (best score found so far for the maximizing player at the root)
        alpha = Math.max(alpha, scoreForThisMove);

        // Beta cutoff check (less relevant at root for finding the *best* move, but standard)
        // if (alpha >= beta) { break; }

    } // End root move loop

    // --- Post-Search ---

    // Sort all evaluated moves by score (descending)
    evaluatedRootMoves.sort((a, b) => b.score - a.score);

    // Store the best move found at this depth in TT if it exists
    if (evaluatedRootMoves.length > 0) {
        const bestMoveFound = evaluatedRootMoves[0].move;
        const bestScoreFound = evaluatedRootMoves[0].score;
        let scoreForStorage = bestScoreFound;
        if (scoreForStorage > EVAL_MATE_SCORE_THRESHOLD) scoreForStorage += 0; // Adjust mate scores for ply 0
        else if (scoreForStorage < EVAL_MATED_SCORE_THRESHOLD) scoreForStorage -= 0;

        const existing = transpositionTable.get(rootHash.toString());
        if (!existing || depth >= existing.depth) { // Store if deeper or same depth (overwrite less accurate/older entries)
             if (Number.isFinite(scoreForStorage)) {
                 transpositionTable.set(rootHash.toString(), { depth: depth, score: scoreForStorage, type: TT_ENTRY_TYPE.EXACT, bestMove: bestMoveFound });
             }
        }
    } else {
        console.warn(`[findBestMoveMinimaxBB D${depth}] No root moves were successfully evaluated.`);
         // This might happen if all moves failed simulation or search; return indicates no valid move found.
         return { moves: [{ move: null, score: EVAL_LOSE_SCORE }] };
    }

    return { moves: evaluatedRootMoves };
}


// --- AI Control Flow ---

/**
 * Controls the AI's move selection using Iterative Deepening (ID) with time management.
 * Initializes search state, calculates time limits, runs the search iteratively,
 * dynamically adjusts depth based on piece count, enforces a minimum search depth,
 * uses a pre-emptive time check, handles results, manages the AI clock,
 * validates the final chosen move *against repetition rules*, and triggers the chosen move or fallback.
 * Includes check for immediate winning move before starting search.
 * Depends on: initializeAISearchState, findImmediateWinningMove, popcount, getPieceCountsBB,
 *             findBestMoveMinimaxBB, performFallbackMove, isValidMoveBB (gameLogic.js),
 *             simulateMoveBB, // <-- Added simulateMoveBB dependency for repetition check
 *             getRestrictedPlayer, // <-- Added dependency
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
            performMove(immediateWin.from, immediateWin.to); // Assumes performMove in main scope
            return;
        }
    } catch (winCheckError) {
        console.error("Error during immediate win check:", winCheckError);
    }

    // --- Calculate Time Limit ---
    const positiveClockTime = Math.max(0, aiPlayerClockTime);
    let allocatedTime = Math.max(MIN_TIME_PER_MOVE, positiveClockTime * 1000 * TIME_USAGE_FACTOR);
    allocatedTime = Math.min(allocatedTime, positiveClockTime * 1000 * 0.8);
    allocatedTime = Math.max(allocatedTime, MIN_TIME_PER_MOVE);
    if (aiPlayerClockTime <= 0) allocatedTime = MIN_TIME_PER_MOVE;
    timeLimit = allocatedTime;
    searchStartTime = performance.now();

    // --- Calculate Dynamic Depth ---
    const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(gameState.bitboards);
    const totalPieces = orangeCount + yellowCount;
    let calculatedDepth;
    if (totalPieces >= 14) { calculatedDepth = OPENING_DEPTH_CAP; }
    else if (totalPieces > 12) { calculatedDepth = 10; }
    else if (totalPieces > 9) { calculatedDepth = 10; }
    else if (totalPieces > 6) { calculatedDepth = 10; }
    else { calculatedDepth = 10; }
    let maxDepthForThisSearch = Math.min(calculatedDepth, MAX_SEARCH_DEPTH);
    maxDepthForThisSearch = Math.max(maxDepthForThisSearch, MIN_FORCED_DEPTH);

    // --- Iterative Deepening Loop ---
    let bestMovesListOverall = []; // Store the list from the last completed depth
    let bestScoreOverall = -Infinity; // Store the score of the top move
    let lastCompletedDepth = 0;
    const rootBitboards = gameState.bitboards;
    const rootHash = gameState.zobristHash;
    const rootGameOver = gameState.gameOver;
    const rootWinner = gameState.winner;
    const playerForMaxID = player;

    for (let currentDepth = 1; currentDepth <= maxDepthForThisSearch; currentDepth++) {
        let allowMateScoreStop = currentDepth >= MIN_FORCED_DEPTH;
        try {
            const elapsedTimeMs = performance.now() - searchStartTime;
            if (currentDepth > 1 && timeLimit > 0 && elapsedTimeMs > timeLimit * TIME_PREDICTION_FACTOR) {
                searchCancelled = true;
                break;
            }
            const result = findBestMoveMinimaxBB(currentDepth, rootBitboards, playerForMaxID, rootHash, rootGameOver, rootWinner);

            if (searchCancelled) break; // Check cancellation *after* search returns

            if (result && result.moves && result.moves.length > 0) {
                // Successfully got a list of moves
                bestMovesListOverall = result.moves; // Update with the latest list
                bestScoreOverall = result.moves[0].score; // Score of the top move
                lastCompletedDepth = currentDepth;

                // Stop checks (mate score, time limit) based on the *best* score found
                if (allowMateScoreStop && Math.abs(bestScoreOverall) > EVAL_MATE_SCORE_THRESHOLD) break;
                if (timeLimit > 0 && performance.now() - searchStartTime >= timeLimit) { searchCancelled = true; break; }

            } else if (result && result.moves && result.moves.length === 1 && result.moves[0].move === null) {
                // Search detected stalemate/checkmate at the root
                bestMovesListOverall = result.moves; // Store the result { move: null, score: ... }
                bestScoreOverall = result.moves[0].score;
                lastCompletedDepth = currentDepth;
                if (allowMateScoreStop && bestScoreOverall < EVAL_MATED_SCORE_THRESHOLD) break; // Stop if checkmated
                if (timeLimit > 0 && performance.now() - searchStartTime >= timeLimit) { searchCancelled = true; break; }

            } else {
                // Search returned null or an empty moves list - indicates an error or unexpected state
                console.warn(`ID Warning: Invalid result object or empty moves list returned from search at depth ${currentDepth}. Using previous depth's result.`);
                break; // Stop deepening if search fails
            }
        } catch (e) {
            console.error(`>>> ID LOOP CAUGHT ERROR at currentDepth = ${currentDepth} <<<`, e);
            if (e instanceof Error) console.error("Stack:", e.stack);
            searchCancelled = true;
            break;
        }
    } // End Iterative Deepening Loop

    // --- Post-Search ---
    const aiEndTime = performance.now();
    const totalTime = (aiEndTime - searchStartTime);
    const totalTimeSec = (totalTime / 1000).toFixed(2);
    console.log(`AI Search Complete. Final Depth: ${lastCompletedDepth}. Nodes: ${nodeCount}, Time: ${totalTimeSec}s`);

    // --- Deduct AI Thinking Time ---
    const elapsedSeconds = Math.max(0, Math.round(totalTime / 1000));
    yellowTime -= elapsedSeconds;
    if (yellowTime < 0) yellowTime = 0;
    updateClockDisplay(PLAYERS.YELLOW, yellowTime);
    if (yellowTime <= 0) { console.log("Yellow time ran out AFTER move calculation."); }

    // --- Validate and Perform Move from the best list ---
    let movePerformed = false;
    if (bestMovesListOverall.length > 0 && bestMovesListOverall[0].move !== null) {
        console.log(`AI considering moves from depth ${lastCompletedDepth}. Top score: ${bestScoreOverall.toFixed(0)}`);

        // Iterate through the ordered list of moves from the search
        for (const evaluatedMove of bestMovesListOverall) {
            const candidateMove = evaluatedMove.move;
            if (!candidateMove || !candidateMove.from || !candidateMove.to || typeof candidateMove.pieceTypeIndex !== 'number') {
                continue; // Skip invalid move objects in the list
            }

            // 1. Basic Validity Check (should already be valid from search, but double-check)
            const fromIdx = coordToBitIndex(candidateMove.from);
            const toIdx = coordToBitIndex(candidateMove.to);
            if (fromIdx === -1 || toIdx === -1) continue;
            const validation = isValidMoveBB(fromIdx, toIdx, candidateMove.pieceTypeIndex, player, gameState.bitboards);
            if (!validation.valid) {
                 console.warn(`AI Warning: Move ${candidateMove.from}->${candidateMove.to} from search list failed basic validation: ${validation.reason}`);
                 continue; // Skip invalid move
            }

            // 2. Repetition Check (mimic the logic in performMoveBB)
            const currentBitboards = gameState.bitboards;
            const currentHash = gameState.zobristHash;
            let isIllegalRepetition = false;

            const simResultForRepCheck = simulateMoveBB(currentBitboards, player, currentHash, candidateMove);
            if (simResultForRepCheck) {
                const nextHashForRepCheck = simResultForRepCheck.nextHash;
                const repetitionCount = gameState.boardStateHistory[nextHashForRepCheck.toString()] || 0;
                if (repetitionCount >= 2) {
                    const { orange: oc, yellow: yc } = getPieceCountsBB(currentBitboards);
                    const restrictedPlayer = getRestrictedPlayer(oc, yc);
                    if (player === restrictedPlayer) {
                        isIllegalRepetition = true;
                         console.log(`AI Note: Skipping move ${candidateMove.from}->${candidateMove.to} due to repetition rule.`);
                    }
                }
            } else {
                 // If simulation fails (e.g. hungry den entry), treat as invalid for this check too.
                 console.warn(`AI Note: Skipping move ${candidateMove.from}->${candidateMove.to} because simulation failed pre-repetition check.`);
                 continue;
            }

            // 3. If NOT an illegal repetition, perform this move
            if (!isIllegalRepetition) {
                console.log(`AI Performing Move: ${candidateMove.from}->${candidateMove.to} (Score: ${evaluatedMove.score.toFixed(0)}, Depth: ${lastCompletedDepth})`);
                performMove(candidateMove.from, candidateMove.to); // Assumes performMove exists in main scope
                movePerformed = true;
                break; // Exit the loop once a valid move is performed
            }
        } // End loop through bestMovesListOverall
    }

    // --- Handle cases where no move was performed ---
    if (!movePerformed) {
        if (bestMovesListOverall.length > 0 && bestMovesListOverall[0].move === null) {
            // Search correctly identified stalemate/checkmate
            console.log("AI Search concluded no valid moves (likely stalemate/checkmate). No move performed.");
             if (!gameState.gameOver) {
                 // This state indicates the *opponent* likely delivered mate/stalemate
                 updateStatus(`Game Over! ${player.toUpperCase()} has no legal moves.`);
                 gameState.gameOver = true;
                  if(bestScoreOverall < EVAL_MATED_SCORE_THRESHOLD) { // Check score to differentiate mate/stalemate
                     gameState.winner = player === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE; // Opponent wins
                  } else {
                      gameState.winner = null; // Draw
                  }
                 disablePlayerInteraction();
                 pauseAllClocks();
                 updateUndoButtonState();
             }
        } else {
            // All moves returned by the search were invalid or rejected by repetition check
            console.error(`AI ERROR: No valid move found in search results! (lastCompletedDepth: ${lastCompletedDepth}). Falling back.`);
            performFallbackMove(player); // Call fallback logic
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
