/**
 * @fileoverview Core game logic, move validation, move execution,
 * and rule checks (stalemate, repetition, hunger) using bitboards.
 */

// --- Piece Counting & Repetition Rule ---

/**
 * Counts the number of pieces for each player from the bitboard state.
 * Depends on: BB_IDX (constants.js), popcount (bitboardUtils.js).
 * @param {bigint[]} bitboards - The bitboard array.
 * @returns {{orange: number, yellow: number}} Object with piece counts. Returns {0, 0} if bitboards invalid.
 */
function getPieceCountsBB(bitboards) {
    // Validate bitboards input
    if (!Array.isArray(bitboards) || bitboards.length !== BB_IDX.COUNT) {
        console.error("getPieceCountsBB Error: Invalid bitboards array provided.");
        return { orange: 0, yellow: 0 };
    }
    // Use the combined player bitboards for efficiency
    const orangeCount = popcount(bitboards[BB_IDX.ORANGE_PIECES]);
    const yellowCount = popcount(bitboards[BB_IDX.YELLOW_PIECES]);
    return { orange: orangeCount, yellow: yellowCount };
}

/**
 * Determines which player is currently restricted by the repetition rule, based on piece counts.
 * The player with more pieces is restricted. If piece counts are equal, Orange is restricted.
 * Depends on: PLAYERS (constants.js).
 * @param {number} orangeCount - Number of orange pieces.
 * @param {number} yellowCount - Number of yellow pieces.
 * @returns {string} The player (PLAYERS.ORANGE or PLAYERS.YELLOW) who is restricted.
 */
function getRestrictedPlayer(orangeCount, yellowCount) {
    if (orangeCount > yellowCount) {
        return PLAYERS.ORANGE;
    } else if (yellowCount > orangeCount) {
        return PLAYERS.YELLOW;
    } else {
        // If counts are equal, the starting player (Orange by convention) is restricted
        return PLAYERS.ORANGE;
    }
}


// --- Move Generation & Validation ---

/**
 * Generates a list of pseudo-legal moves for a given player using bitboards.
 * Finds geometrically possible moves (orthogonal, jumps, swimming) considering
 * basic terrain (water) and avoiding moves onto own pieces or into own den.
 * Skips rank validation, traps, jump blocking, repetition, hunger checks.
 * Depends on: BB_IDX, ROWS, COLS, SQUARES, PLAYERS (constants.js), SPECIAL_ABILITIES,
 *             lsbIndex, getBit, clearBit, coordToBitIndex, bitIndexToCoord (bitboardUtils.js),
 *             waterBB, orangeDenBB, yellowDenBB (bitboardUtils.js state).
 *
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW) whose moves to find.
 * @param {boolean} [isSimulation=false] - If true, suppress non-critical console warnings.
 * @returns {Array<object>} An array of *legal* move objects [{ from: string, to: string, pieceTypeIndex: number }, ...], respecting hungry rules.
 */
function getAllValidMovesBB(bitboards, player, isSimulation = false) {
    const fnName = "getAllValidMovesBB";

    // --- Input Validation ---
    if (!Array.isArray(bitboards) || bitboards.length !== BB_IDX.COUNT) {
         console.error(`[${fnName}] Error: Invalid bitboards array provided.`);
         return [];
    }
    if (player !== PLAYERS.ORANGE && player !== PLAYERS.YELLOW) {
         console.error(`[${fnName}] Error: Invalid player specified: ${player}`);
         console.error(`[${fnName}] Error: Invalid bitboards array provided.`);
         return [];
    }
    if (player !== PLAYERS.ORANGE && player !== PLAYERS.YELLOW) {
         console.error(`[${fnName}] Error: Invalid player specified: ${player}`);
         return [];
    }
    // --- End Validation ---

    // --- START NEW HUNGER LOGIC ---
    const playerHungryBB = gameState.hungryBB?.[player] ?? BB_EMPTY;
    const opponentBBIndex = player === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
    const opponentPiecesBB = bitboards[opponentBBIndex];

    if (playerHungryBB !== BB_EMPTY) {
        const hungryMoves = []; // Store all valid moves by hungry pieces
        let tempHungryPieces = playerHungryBB;

        // Iterate through ONLY hungry pieces
        while (tempHungryPieces !== BB_EMPTY) {
            const hungryFromIndex = lsbIndex(tempHungryPieces);
            if (hungryFromIndex === -1) break;

            // Find the piece type at this hungry location
            let hungryPieceTypeIndex = -1;
            for (let typeIdx = BB_IDX.PIECE_START; typeIdx <= BB_IDX.PIECE_END; typeIdx++) {
                // Check the *provided* bitboards, not gameState
                if (getBit(bitboards[typeIdx], hungryFromIndex) !== 0n) {
                    hungryPieceTypeIndex = typeIdx;
                    break;
                }
            }

            if (hungryPieceTypeIndex !== -1) {
                // Generate moves for THIS specific hungry piece
                const hungryFromCoord = bitIndexToCoord(hungryFromIndex);
                if (hungryFromCoord) {
                    // --- Replicate move generation logic for this single piece ---
                    const rank = (hungryPieceTypeIndex % 8) + 1;
                    const abilities = SPECIAL_ABILITIES[rank];
                    if (!abilities) { // Basic check for abilities
                         console.error(`[${fnName}] Error: Missing abilities for hungry rank ${rank} (type ${hungryPieceTypeIndex}).`);
                         tempHungryPieces = clearBit(tempHungryPieces, hungryFromIndex); // Skip this piece
                         continue;
                    }
                    const isSwimmer = abilities.swims || false;
                    const canJumpV = abilities.jumpV || false;
                    const canJumpH = abilities.jumpH || false;
                    const isFromLand = getBit(waterBB, hungryFromIndex) === 0n;
                    const ownPiecesBB = bitboards[player === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES];
                    const ownDenBB = player === PLAYERS.ORANGE ? orangeDenBB : yellowDenBB;
                    let targetSquaresBB = BB_EMPTY;
                    const pieceBB = 1n << BigInt(hungryFromIndex);

                    // Orthogonal
                    let potentialOrthoTargets = BB_EMPTY;
                    const fromRow = Math.floor(hungryFromIndex / COLS);
                    const fromCol = hungryFromIndex % COLS;
                    if (fromRow > 0) potentialOrthoTargets |= (pieceBB >> BigInt(COLS));
                    if (fromRow < ROWS - 1) potentialOrthoTargets |= (pieceBB << BigInt(COLS));
                    if (fromCol > 0) potentialOrthoTargets |= (pieceBB >> 1n);
                    if (fromCol < COLS - 1) potentialOrthoTargets |= (pieceBB << 1n);
                    potentialOrthoTargets &= ~ownPiecesBB;
                    potentialOrthoTargets &= ~ownDenBB;
                    if (!isSwimmer) potentialOrthoTargets &= ~waterBB;
                    targetSquaresBB |= potentialOrthoTargets;

                    // Jumps
                    if (isFromLand) {
                        let potentialJumpTargets = BB_EMPTY;
                        if (canJumpV && (fromCol === 1 || fromCol === 2 || fromCol === 4 || fromCol === 5)) {
                            if (hungryFromIndex >= 4 * COLS) potentialJumpTargets |= (pieceBB >> BigInt(4 * COLS));
                            if (hungryFromIndex < SQUARES - (4 * COLS)) potentialJumpTargets |= (pieceBB << BigInt(4 * COLS));
                        }
                        if (canJumpH && (fromRow >= 3 && fromRow <= 5)) {
                            if (fromCol >= 3) potentialJumpTargets |= (pieceBB >> 3n);
                            if (fromCol <= COLS - 1 - 3) potentialJumpTargets |= (pieceBB << 3n);
                        }
                        potentialJumpTargets &= ~ownPiecesBB;
                        potentialJumpTargets &= ~ownDenBB;
                        potentialJumpTargets &= ~waterBB; // Jumps must land on land
                        // Check jump path clear for jumps
                        let validJumpTargets = BB_EMPTY;
                        let tempJumpTargets = potentialJumpTargets;
                        while(tempJumpTargets !== BB_EMPTY) {
                            const jumpTargetIdx = lsbIndex(tempJumpTargets);
                            if (jumpTargetIdx !== -1) {
                                if (checkJumpPathClearBB(hungryFromIndex, jumpTargetIdx, player, bitboards)) {
                                    validJumpTargets = setBit(validJumpTargets, jumpTargetIdx);
                                }
                            }
                            tempJumpTargets = clearBit(tempJumpTargets, jumpTargetIdx);
                        }
                        targetSquaresBB |= validJumpTargets; // Add only valid jumps
                    }

                    // Process targets for this hungry piece
                    let currentTargets = targetSquaresBB;
                    while (currentTargets !== BB_EMPTY) {
                        const targetIndex = lsbIndex(currentTargets);
                        if (targetIndex !== -1 && targetIndex < SQUARES) {
                            const targetCoord = bitIndexToCoord(targetIndex);
                            if (targetCoord) {
                                // Check if this specific move is valid using isValidMoveBB
                                const validation = isValidMoveBB(hungryFromIndex, targetIndex, hungryPieceTypeIndex, player, bitboards);
                                if (validation.valid) {
                                    hungryMoves.push({ from: hungryFromCoord, to: targetCoord, pieceTypeIndex: hungryPieceTypeIndex });
                                }
                            }
                        } else {
                             if (!isSimulation) console.error(`[${fnName}] Error: Invalid LSB target index ${targetIndex} for hungry piece.`);
                             break; // Prevent potential infinite loop
                        }
                        currentTargets = clearBit(currentTargets, targetIndex);
                    }
                    // --- End replicated move generation ---
                } else {
                     if (!isSimulation) console.error(`[${fnName}] Error: Invalid fromCoord for hungry index ${hungryFromIndex}.`);
                }
            } else {
                 if (!isSimulation) console.error(`[${fnName}] Error: Could not find piece type for hungry piece at index ${hungryFromIndex}.`);
            }
            tempHungryPieces = clearBit(tempHungryPieces, hungryFromIndex);
        } // End while (tempHungryPieces)

        // Filter hungryMoves for captures
        const captureMoves = hungryMoves.filter(move => {
            const toIndex = coordToBitIndex(move.to);
            // Check if the target square has an opponent piece
            return toIndex !== -1 && getBit(opponentPiecesBB, toIndex) !== 0n;
        });

        // Return based on capture availability
        if (captureMoves.length > 0) {
            // console.log(`[${fnName}] Player ${player} is hungry. Returning ${captureMoves.length} capture moves only.`);
            return captureMoves; // Return ONLY valid captures by hungry pieces
        } else {
            // console.log(`[${fnName}] Player ${player} is hungry but has no captures. Returning ${hungryMoves.length} non-capture moves.`);
            return hungryMoves; // Return ALL valid moves by hungry pieces (no captures possible)
        }
    }
    // --- END NEW HUNGER LOGIC ---

    // --- ORIGINAL LOGIC (if not hungry) ---
    const moves = []; // Original moves array initialization
    const playerBBIndex = player === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;
    const ownPiecesBB = bitboards[playerBBIndex];
    const ownDenBB = player === PLAYERS.ORANGE ? orangeDenBB : yellowDenBB;

    const pieceTypeStart = player === PLAYERS.ORANGE ? BB_IDX.PIECE_START : Y_RAT_IDX;
    const pieceTypeEnd = player === PLAYERS.ORANGE ? O_ELEPHANT_IDX : BB_IDX.PIECE_END;

    for (let pieceTypeIndex = pieceTypeStart; pieceTypeIndex <= pieceTypeEnd; pieceTypeIndex++) {
        let pieceBoard = bitboards[pieceTypeIndex]; // BB for the current piece type

        while (pieceBoard !== BB_EMPTY) {
            const fromIndex = lsbIndex(pieceBoard);
            if (fromIndex === -1 || fromIndex >= SQUARES) {
                if (!isSimulation) console.error(`[${fnName}] Error: Invalid LSB index ${fromIndex} for type ${pieceTypeIndex}.`);
                break; // Prevent infinite loop
            }

            const fromCoord = bitIndexToCoord(fromIndex);
            if (!fromCoord) {
                if (!isSimulation) console.error(`[${fnName}] Error: Invalid fromCoord for index ${fromIndex}.`);
                pieceBoard = clearBit(pieceBoard, fromIndex); // Clear the problematic bit
                continue; // Move to next piece of this type
            }

            const rank = (pieceTypeIndex % 8) + 1;
            const abilities = SPECIAL_ABILITIES[rank];
            if (!abilities) {
                 if (!isSimulation) console.error(`[${fnName}] Error: Missing abilities for rank ${rank} (type ${pieceTypeIndex}).`);
                 pieceBoard = clearBit(pieceBoard, fromIndex);
                 continue;
            }

            const isSwimmer = abilities.swims || false;
            const canJumpV = abilities.jumpV || false;
            const canJumpH = abilities.jumpH || false;
            const isFromLand = getBit(waterBB, fromIndex) === 0n;

            // Generate potential target squares bitboard for this piece
            let targetSquaresBB = BB_EMPTY;
            const pieceBB = 1n << BigInt(fromIndex);

            // --- Orthogonal Moves ---
            let potentialOrthoTargets = BB_EMPTY;
            const fromRow = Math.floor(fromIndex / COLS);
            const fromCol = fromIndex % COLS;

            if (fromRow > 0) potentialOrthoTargets |= (pieceBB >> BigInt(COLS)); // North
            if (fromRow < ROWS - 1) potentialOrthoTargets |= (pieceBB << BigInt(COLS)); // South
            if (fromCol > 0) potentialOrthoTargets |= (pieceBB >> 1n);        // West
            if (fromCol < COLS - 1) potentialOrthoTargets |= (pieceBB << 1n);        // East

            // Filter orthogonal targets: remove own pieces and own den first
            potentialOrthoTargets &= ~ownPiecesBB;
            potentialOrthoTargets &= ~ownDenBB;

            // Apply water filter ONLY if the piece is NOT a swimmer
            if (!isSwimmer) {
                potentialOrthoTargets &= ~waterBB;
            }
            // Now add the correctly filtered ortho moves
            targetSquaresBB |= potentialOrthoTargets;

            // --- Jump Moves (only from land) ---
            if (isFromLand) {
                let potentialJumpTargets = BB_EMPTY; // Calculate jump targets separately
                // Vertical Jumps
                 if (canJumpV && (fromCol === 1 || fromCol === 2 || fromCol === 4 || fromCol === 5)) {
                    if (fromIndex >= 4 * COLS) potentialJumpTargets |= (pieceBB >> BigInt(4 * COLS));
                    if (fromIndex < SQUARES - (4 * COLS)) potentialJumpTargets |= (pieceBB << BigInt(4 * COLS));
                }
                // Horizontal Jumps
                if (canJumpH && (fromRow >= 3 && fromRow <= 5)) {
                    if (fromCol >= 3) potentialJumpTargets |= (pieceBB >> 3n);
                    if (fromCol <= COLS - 1 - 3) potentialJumpTargets |= (pieceBB << 3n);
                }

                // Filter jump targets: remove own pieces, own den, AND water squares
                potentialJumpTargets &= ~ownPiecesBB;
                potentialJumpTargets &= ~ownDenBB;
                potentialJumpTargets &= ~waterBB; // Jumps must land on land

                // Check jump path clear for jumps
                let validJumpTargets = BB_EMPTY;
                let tempJumpTargets = potentialJumpTargets;
                while(tempJumpTargets !== BB_EMPTY) {
                    const jumpTargetIdx = lsbIndex(tempJumpTargets);
                    if (jumpTargetIdx !== -1 && jumpTargetIdx < SQUARES) {
                        if (checkJumpPathClearBB(fromIndex, jumpTargetIdx, player, bitboards)) {
                            validJumpTargets = setBit(validJumpTargets, jumpTargetIdx);
                        }
                    } else {
                         if (!isSimulation) console.error(`[${fnName}] Error: Invalid LSB jump target index ${jumpTargetIdx}.`);
                         break;
                    }
                    tempJumpTargets = clearBit(tempJumpTargets, jumpTargetIdx);
                }
                targetSquaresBB |= validJumpTargets; // Add only valid jumps
            }

            // --- Process Valid Target Squares ---
            let currentTargets = targetSquaresBB;
            while (currentTargets !== BB_EMPTY) {
                const targetIndex = lsbIndex(currentTargets);
                if (targetIndex !== -1 && targetIndex < SQUARES) {
                    const targetCoord = bitIndexToCoord(targetIndex);
                    if (targetCoord) {
                        // Add the pseudo-legal move (validation happens later or in AI)
                        moves.push({ from: fromCoord, to: targetCoord, pieceTypeIndex: pieceTypeIndex });
                    } else {
                        if (!isSimulation) console.warn(`[${fnName}] Warning: Invalid targetCoord for index ${targetIndex} from piece at ${fromCoord}.`);
                    }
                } else {
                    if (!isSimulation) console.error(`[${fnName}] Error: Invalid LSB target index ${targetIndex}.`);
                    break; // Prevent potential infinite loop
                }
                currentTargets = clearBit(currentTargets, targetIndex);
            }

            // Clear the processed piece's bit from the temp board
            pieceBoard = clearBit(pieceBoard, fromIndex);
        } // End while (pieceBoard)
    } // End for (pieceTypeIndex)

    return moves;
}

/**
 * Parses a board state string into a bitboard array.
 * String format: "RankCoordsUpper/Lower,RankCoordsUpper/Lower,..." (e.g., "8A3,7g1,1a7")
 * Uppercase coords = Orange, Lowercase = Yellow.
 * Depends on: BB_IDX, PLAYERS, RANK_TO_CODE (constants.js), BB_EMPTY (bitboardUtils.js),
 *             coordToBitIndex, setBit (bitboardUtils.js), getPieceTypeIndex (utils.js).
 *
 * @param {string} stateString - The board state string to parse.
 * @returns {bigint[]|null} A bitboard array or null if parsing fails.
 */
function parseBoardStateStringBB(stateString) {
    if (!stateString || typeof stateString !== 'string') {
        console.error("Parse Error: Invalid input string.");
        return null;
    }

    const bitboards = new Array(BB_IDX.COUNT).fill(BB_EMPTY);
    const pieceStrings = stateString.trim().split(',');
    // Regex to match Rank (1-8) and Coords (case-insensitive a-g, 1-9)
    const pieceRegex = /^([1-8])([a-gA-G][1-9])$/;

    for (const pieceStr of pieceStrings) {
        if (!pieceStr) continue; // Skip empty parts
        const match = pieceStr.trim().match(pieceRegex);

        if (!match) {
            console.error(`Parse Error: Invalid piece format "${pieceStr}" in state string.`);
            return null;
        }

        const rank = parseInt(match[1], 10);
        const coordsRaw = match[2];
        const coordsLower = coordsRaw.toLowerCase(); // Use lowercase for index lookup

        // Validate coordinates range
        const bitIndex = coordToBitIndex(coordsLower);
        if (bitIndex === -1) {
            console.error(`Parse Error: Invalid coordinates "${coordsRaw}" -> "${coordsLower}" in state string.`);
            return null;
        }

        // Determine player based on original case
        const player = (coordsRaw === coordsRaw.toUpperCase()) ? PLAYERS.ORANGE : PLAYERS.YELLOW;
        const pieceTypeIndex = getPieceTypeIndex(player, rank);
        const playerIndex = player === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;

        if (pieceTypeIndex === -1) {
             console.error(`Parse Error: Could not determine piece type index for player ${player}, rank ${rank}.`);
             return null;
        }

        // Check for duplicate piece placement (by checking if bit is already set in combined board)
        if (getBit(bitboards[BB_IDX.OCCUPIED], bitIndex) !== 0n) {
             console.error(`Parse Error: Duplicate piece placement detected at "${coordsLower}" in state string.`);
             return null;
        }

        // Set bits
        bitboards[pieceTypeIndex] = setBit(bitboards[pieceTypeIndex], bitIndex);
        bitboards[playerIndex] = setBit(bitboards[playerIndex], bitIndex);
        bitboards[BB_IDX.OCCUPIED] = setBit(bitboards[BB_IDX.OCCUPIED], bitIndex); // Update combined board
    }

    // Basic sanity check: ensure at least one piece exists if string wasn't empty?
    if (bitboards[BB_IDX.OCCUPIED] === BB_EMPTY && stateString.length > 0) {
        console.error("Parse Error: String provided but no valid pieces parsed.");
        return null;
    }

    console.log("Successfully parsed board state string to bitboards.");
    return bitboards;
}

/**
 * Determines if a specific move is legal using Bitboards. Includes hungry den entry check.
 * Checks geometry, terrain, occupancy, captures (rank, traps), special rules.
 * *** Trap Rule: ANY piece on ANY trap square (ALL_TRAP_SQUARES / allTrapsBB) has effective rank 0 when being attacked. ***
 * *** Excludes Repetition Check (handled elsewhere). ***
 * Depends on: BB_IDX, SQUARES, PLAYERS, SPECIAL_ABILITIES (constants.js),
 *             getBit, coordToBitIndex, bitIndexToCoord, allTrapsBB (bitboardUtils.js),
 *             waterBB, orangeDenBB, yellowDenBB (bitboardUtils.js state),
 *             O_ELEPHANT_IDX, Y_ELEPHANT_IDX (constants.js), checkJumpPathClearBB,
 *             gameState (for hungryBB access).
 *
 * @param {number} fromIndex - Starting square index (0-62).
 * @param {number} toIndex - Ending square index (0-62).
 * @param {number} pieceTypeIndex - Index (0-15) of the moving piece.
 * @param {string} player - Player making the move (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @returns {{valid: boolean, reason: string, reasonCode?: string}} Validity object.
 */
function isValidMoveBB(fromIndex, toIndex, pieceTypeIndex, player, bitboards) {

    // --- Basic Index & Input Validation ---
    if (fromIndex < 0 || fromIndex >= SQUARES || toIndex < 0 || toIndex >= SQUARES ||
        pieceTypeIndex < BB_IDX.PIECE_START || pieceTypeIndex > BB_IDX.PIECE_END ||
        (player !== PLAYERS.ORANGE && player !== PLAYERS.YELLOW) ||
        !Array.isArray(bitboards) || bitboards.length !== BB_IDX.COUNT)
    {
        return { valid: false, reason: "Internal error: Invalid arguments or indices." };
    }
    if (fromIndex === toIndex) return { valid: false, reason: "Cannot move to the same square." };

    // --- Get Piece Info & Opponent ---
    const rank = (pieceTypeIndex % 8) + 1;
    const abilities = SPECIAL_ABILITIES[rank];
    if (!abilities) {
        console.error(`isValidMoveBB Error: Missing abilities for rank ${rank} (type ${pieceTypeIndex}).`);
        return { valid: false, reason: "Internal error: Missing piece abilities." };
    }
    const isSwimmer = abilities.swims || false;
    const canJumpV = abilities.jumpV || false;
    const canJumpH = abilities.jumpH || false;
    const isRat = rank === 1;
    const opponent = player === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;

    // --- Get Relevant Bitboards ---
    const playerBBIndex = player === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;
    const opponentBBIndex = player === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
    const ownPiecesBB = bitboards[playerBBIndex];
    const opponentPiecesBB = bitboards[opponentBBIndex];
    const ownDenBB = player === PLAYERS.ORANGE ? orangeDenBB : yellowDenBB;
    const opponentDenBB = player === PLAYERS.ORANGE ? yellowDenBB : orangeDenBB;

    // --- Basic Occupancy & Source Checks ---
    if (getBit(ownPiecesBB, toIndex) !== 0n) { return { valid: false, reason: "Cannot capture your own piece." }; }
    if (getBit(ownDenBB, toIndex) !== 0n) { return { valid: false, reason: "Cannot enter your own den." }; }
    if (getBit(bitboards[pieceTypeIndex], fromIndex) === 0n) {
        console.error(`isValidMoveBB Error: Piece type ${pieceTypeIndex} not found at fromIndex ${fromIndex}`);
        return { valid: false, reason: "Internal Error: Moving piece not found at source." };
    }

    // --- Terrain Interaction Checks ---
    const isMovingToWater = getBit(waterBB, toIndex) !== 0n;
    const isMovingFromWater = getBit(waterBB, fromIndex) !== 0n;
    const isTargetOccupiedByOpponent = getBit(opponentPiecesBB, toIndex) !== 0n;

    if (isMovingToWater && !isSwimmer) { return { valid: false, reason: "This animal cannot enter water." }; }
    if (isMovingFromWater && isTargetOccupiedByOpponent && !isSwimmer) { return { valid: false, reason: "Only Rat or Dog can attack from water." }; }
    if (isRat && isMovingFromWater) {
        const opponentElephantIndex = opponent === PLAYERS.ORANGE ? O_ELEPHANT_IDX : Y_ELEPHANT_IDX;
        if (getBit(bitboards[opponentElephantIndex], toIndex) !== 0n) { return { valid: false, reason: "Rat cannot attack Elephant from water." }; }
    }

    // --- Check Geometric Validity ---
    let isGeometricMoveValid = false;
    const fromRow = Math.floor(fromIndex / COLS);
    const fromCol = fromIndex % COLS;
    const toRow = Math.floor(toIndex / COLS);
    const toCol = toIndex % COLS;
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);

    if ((rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1)) { isGeometricMoveValid = true; }
    const isFromLand = !isMovingFromWater;
    const isToLand = !isMovingToWater;
    if (!isGeometricMoveValid && isFromLand && isToLand) {
        const isVerticalJumpGeom = colDiff === 0 && rowDiff === 4 && (fromCol === 1 || fromCol === 2 || fromCol === 4 || fromCol === 5);
        const isHorizontalJumpGeom = rowDiff === 0 && colDiff === 3 && (fromRow >= 3 && fromRow <= 5);
        if (isVerticalJumpGeom || isHorizontalJumpGeom) {
            if ((isVerticalJumpGeom && !canJumpV) || (isHorizontalJumpGeom && !canJumpH)) { return { valid: false, reason: "This animal cannot jump that way." }; }
            if (!checkJumpPathClearBB(fromIndex, toIndex, player, bitboards)) { return { valid: false, reason: "Jump path blocked by opponent in water." }; }
            isGeometricMoveValid = true;
        }
    }
    if (!isGeometricMoveValid) { return { valid: false, reason: "Invalid move geometry (not orthogonal or valid jump)." }; }

    // --- Capture Rules ---
    if (isTargetOccupiedByOpponent) {
        let attackerRank = rank;
        let defenderRank = -1; // Defender's original rank
        let defenderPieceTypeIndex = -1;

        // Find the defender's original rank/type
        const oppTypeStart = opponent === PLAYERS.ORANGE ? BB_IDX.PIECE_START : Y_RAT_IDX;
        const oppTypeEnd = opponent === PLAYERS.ORANGE ? O_ELEPHANT_IDX : BB_IDX.PIECE_END;
        for (let oppTypeIdx = oppTypeStart; oppTypeIdx <= oppTypeEnd; oppTypeIdx++) {
            if (getBit(bitboards[oppTypeIdx], toIndex) !== 0n) {
                defenderPieceTypeIndex = oppTypeIdx;
                defenderRank = (oppTypeIdx % 8) + 1;
                break;
            }
        }

        if (defenderRank === -1) {
            console.error(`isValidMoveBB Error: Opponent piece expected at index ${toIndex} but type not found.`);
            return { valid: false, reason: "Internal error: Cannot identify piece to capture." };
        }

        // --- Trap Logic (Rule: ANY piece on ANY trap = Rank 0 for defense) ---
        const isTargetSquareTrap = getBit(allTrapsBB, toIndex) !== 0n; // Renamed variable
        let defenderEffectiveRank = isTargetSquareTrap ? 0 : defenderRank; // Renamed variable
        // --- End Trap Logic ---

        const isRatAttackElephant = isRat && defenderRank === 8;

        // --- DETAILED CAPTURE LOGIC DEBUG ---
        // const fromCoords = bitIndexToCoord(fromIndex);
        // const toCoords = bitIndexToCoord(toIndex);
        // --- END DEBUG ---

        if (isRatAttackElephant) {
            if (isMovingFromWater) { return { valid: false, reason: "Rat cannot attack Elephant from water." }; }
        }
        else if (attackerRank < defenderEffectiveRank) {
            const reasonMsg = `Cannot attack higher-ranked animal (${attackerRank} vs ${defenderRank}${isTargetSquareTrap ? ' [Trap->0]' : ''}).`;
            return { valid: false, reason: reasonMsg, reasonCode: 'RANK_TOO_LOW' };
        } else {
            // Attacker rank >= defender effective rank (or Rat vs Elephant on land) -> Valid capture
        }
    }

    // --- Hunger Check (Den Entry) ---
    const isMovingToOpponentDen = getBit(opponentDenBB, toIndex) !== 0n;
    if (isMovingToOpponentDen && !isTargetOccupiedByOpponent) {
        const currentHungryBB = gameState.hungryBB?.[player] ?? BB_EMPTY;
        const isPieceHungry = getBit(currentHungryBB, fromIndex) !== 0n;
        if (isPieceHungry) {
             return { valid: false, reason: "Hungry animal cannot enter opponent den without capturing." };
        }
    }

    // If all checks passed
    return { valid: true, reason: "" };
}

/**
 * Generates a unique string representation of the current board state from bitboards.
 * Used for display and potentially loading (though hash is better for repetition).
 * Format: "RankCoordsUpper/Lower,RankCoordsUpper/Lower,..." sorted alphabetically by coords.
 * Example: "6a1,1g3,7g1..." (Lowercase coords always used for sorting consistency).
 * Depends on: BB_IDX, SQUARES, PLAYERS, RANK_TO_CODE (constants.js),
 *             lsbIndex, clearBit, bitIndexToCoord (bitboardUtils.js).
 *
 * @param {bigint[]} [bitboards=gameState.bitboards] - The bitboard state to stringify.
 * @returns {string} The sorted comma-separated string representation.
 */
function getBoardStateStringBB(bitboards = gameState.bitboards) {
    const pieces = [];
    if (!bitboards || bitboards.length !== BB_IDX.COUNT) {
        console.error("getBoardStateStringBB Error: Invalid bitboards array.");
        return "Error";
    }

    // Iterate through all squares to ensure consistent order
    for (let index = 0; index < SQUARES; index++) {
        let foundPiece = false;
        // Check each piece type bitboard for this square index
        for (let pieceTypeIndex = BB_IDX.PIECE_START; pieceTypeIndex <= BB_IDX.PIECE_END; pieceTypeIndex++) {
            if (getBit(bitboards[pieceTypeIndex], index) !== 0n) {
                // Found the piece at this square
                const rank = (pieceTypeIndex % 8) + 1;
                const player = pieceTypeIndex < 8 ? PLAYERS.ORANGE : PLAYERS.YELLOW;
                const coords = bitIndexToCoord(index);

                if (coords) {
                    // Format: Rank code followed by Coords. Uppercase for Orange, lowercase for Yellow.
                    const stateOutput = player === PLAYERS.ORANGE ?
                        `${RANK_TO_CODE[rank]}${coords.toUpperCase()}` :
                        `${RANK_TO_CODE[rank]}${coords.toLowerCase()}`;
                    pieces.push({ sortKey: coords.toLowerCase(), value: stateOutput });
                }
                foundPiece = true;
                break; // Stop checking piece types for this square once found
            }
        }
    }

    // Sort pieces alphabetically based on their lowercase coordinates
    pieces.sort((a, b) => {
        // Primarily sort by column ('a' < 'b')
        if (a.sortKey[0] !== b.sortKey[0]) {
            return a.sortKey.charCodeAt(0) - b.sortKey.charCodeAt(0);
        }
        // Secondarily sort by row number descending ('9' > '1')
        const rowA = parseInt(a.sortKey.substring(1));
        const rowB = parseInt(b.sortKey.substring(1));
        return rowB - rowA; // Higher row number comes first
    });

    // Join the formatted values
    return pieces.map(p => p.value).join(',');
}


// --- Move Simulation ---

/**
 * Simulates a pseudo-legal move on a copy of the bitboard state and updates the Zobrist hash.
 * Assumes the move is geometrically valid and doesn't land on an own piece or own den.
 * Determines captures based on opponent occupancy at the destination.
 * *** VALIDATES rank/trap rules for captures before proceeding. ***
 * *** Includes check for hungry piece entering opponent den. ***
 * Depends on: BB_IDX, SQUARES, PLAYERS, SPECIAL_ABILITIES (constants.js),
 *             coordToBitIndex, getBit, clearBit, setBit, togglePieceKeyBB, toggleTurnKey (bitboardUtils.js/gameState.js),
 *             waterBB, allTrapsBB, // Added waterBB, allTrapsBB
 *             orangeDenBB, yellowDenBB (bitboardUtils.js state), gameState (for hungryBB access).
 *
 * @param {bigint[]} currentBitboards - The current bitboard array state.
 * @param {string} currentPlayer - The player making the move (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {bigint} currentHash - The Zobrist hash of the current state.
 * @param {object} move - The move object { from: string, to: string, pieceTypeIndex: number }.
 * @returns {{nextBitboards: bigint[], nextPlayer: string, nextHash: bigint, nextGameOver: boolean, nextWinner: string|null, capturedPieceTypeIndex: number|null}|null}
 *          An object with the resulting state, or null if a critical error occurs or move is illegal due to hungry den entry.
 */
function simulateMoveBB(currentBitboards, currentPlayer, currentHash, move) {

    // --- Input Validation & Setup ---
    // (Same as before)
    if (!currentBitboards || !currentPlayer || typeof currentHash !== 'bigint' || !move || !move.from || !move.to || typeof move.pieceTypeIndex !== 'number' ||
        move.pieceTypeIndex < BB_IDX.PIECE_START || move.pieceTypeIndex > BB_IDX.PIECE_END ||
        !Array.isArray(currentBitboards) || currentBitboards.length !== BB_IDX.COUNT)
    {
        console.error("simulateMoveBB Error: Invalid input.", { currentBitboards, currentPlayer, currentHash, move });
        return null;
    }

    const fromIndex = coordToBitIndex(move.from);
    const toIndex = coordToBitIndex(move.to);
    const movingPieceTypeIndex = move.pieceTypeIndex;

    if (fromIndex === -1 || toIndex === -1) {
        console.error("simulateMoveBB Error: Invalid coordinate index.", { move, fromIndex, toIndex });
        return null;
    }

    const opponent = currentPlayer === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const opponentBBIndex = currentPlayer === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
    const opponentPiecesBB = currentBitboards[opponentBBIndex];
    const opponentDenBB = currentPlayer === PLAYERS.ORANGE ? yellowDenBB : orangeDenBB;
    const isTargetOccupiedByOpponent = getBit(opponentPiecesBB, toIndex) !== 0n;

    // --- *** ADDED HUNGRY DEN ENTRY CHECK *** ---
    const isMovingToOpponentDen = getBit(opponentDenBB, toIndex) !== 0n;
    if (isMovingToOpponentDen && !isTargetOccupiedByOpponent) { // If moving to opponent den WITHOUT capturing
        // Check if the piece starting the move is hungry in the CURRENT state
        // Access global gameState here as simulation needs context of current hungry state
        const currentHungryBB = gameState.hungryBB?.[currentPlayer] ?? BB_EMPTY;
        const isPieceHungry = getBit(currentHungryBB, fromIndex) !== 0n;
        if (isPieceHungry) {
            // console.warn(`simulateMoveBB: Blocking illegal hungry den entry ${move.from}->${move.to}`);
            return null; // Treat this move as impossible to simulate -> leads to failure in search
        }
    }
    // --- *** END HUNGRY DEN ENTRY CHECK *** ---


    // Create a copy of the bitboards to modify
    const nextBitboards = [...currentBitboards];
    let nextHash = currentHash;

    const playerBBIndex = currentPlayer === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;

    // Check if the moving piece actually exists
    if (getBit(nextBitboards[movingPieceTypeIndex], fromIndex) === 0n) {
        console.error(`simulateMoveBB Error: Piece of type ${movingPieceTypeIndex} not found at fromIndex ${fromIndex} (${move.from})`);
        return null;
    }

    // Detect Capture
    // Detect Capture & Validate
    let capturedPieceTypeIndex = null;
    const isCapture = isTargetOccupiedByOpponent; // Use pre-calculated value

    if (isCapture) {
        // --- *** ADDED CAPTURE VALIDATION *** ---
        let attackerRank = (movingPieceTypeIndex % 8) + 1;
        let defenderRank = -1;
        let defenderPieceTypeIndex = -1; // Temp variable for finding

        // Find the defender's original rank/type from the *current* boards
        const oppTypeStart = opponent === PLAYERS.ORANGE ? BB_IDX.PIECE_START : Y_RAT_IDX;
        const oppTypeEnd = opponent === PLAYERS.ORANGE ? O_ELEPHANT_IDX : BB_IDX.PIECE_END;
        for (let oppTypeIdx = oppTypeStart; oppTypeIdx <= oppTypeEnd; oppTypeIdx++) {
            if (getBit(currentBitboards[oppTypeIdx], toIndex) !== 0n) { // Check original boards
                defenderPieceTypeIndex = oppTypeIdx;
                defenderRank = (oppTypeIdx % 8) + 1;
                break;
            }
        }

        if (defenderRank === -1) {
            console.error(`simulateMoveBB Error: Capture detected at ${move.to}, but couldn't identify captured piece type for validation.`);
            return null; // Critical error if we can't find the piece to validate against
        }

        // Trap Logic
        const isTargetSquareTrap = getBit(allTrapsBB, toIndex) !== 0n;
        let defenderEffectiveRank = isTargetSquareTrap ? 0 : defenderRank;

        // Rank Check
        const isRat = attackerRank === 1;
        const isRatAttackElephant = isRat && defenderRank === 8;
        const isMovingFromWater = getBit(waterBB, fromIndex) !== 0n; // Need this check

        if (isRatAttackElephant) {
            if (isMovingFromWater) {
                // console.warn(`simulateMoveBB: Blocking illegal Rat->Elephant capture from water ${move.from}->${move.to}`);
                return null; // Illegal capture
            }
        } else if (attackerRank < defenderEffectiveRank) {
            // console.warn(`simulateMoveBB: Blocking illegal capture due to rank ${attackerRank} vs ${defenderRank} (Eff: ${defenderEffectiveRank}) at ${move.to}`);
            return null; // Illegal capture
        }
        // If we reach here, the capture is valid according to rank/trap rules
        capturedPieceTypeIndex = defenderPieceTypeIndex; // Assign the validated captured index
        // --- *** END CAPTURE VALIDATION *** ---
    }

    // --- Update Bitboards (Only if move is valid so far) ---
    nextBitboards[movingPieceTypeIndex] = clearBit(nextBitboards[movingPieceTypeIndex], fromIndex);
    nextBitboards[playerBBIndex] = clearBit(nextBitboards[playerBBIndex], fromIndex);
    if (isCapture && capturedPieceTypeIndex !== null) { // Use the validated index
        nextBitboards[capturedPieceTypeIndex] = clearBit(nextBitboards[capturedPieceTypeIndex], toIndex);
        nextBitboards[opponentBBIndex] = clearBit(nextBitboards[opponentBBIndex], toIndex);
    }
    nextBitboards[movingPieceTypeIndex] = setBit(nextBitboards[movingPieceTypeIndex], toIndex);
    nextBitboards[playerBBIndex] = setBit(nextBitboards[playerBBIndex], toIndex);
    nextBitboards[BB_IDX.OCCUPIED] = nextBitboards[BB_IDX.ORANGE_PIECES] | nextBitboards[BB_IDX.YELLOW_PIECES];

    // --- Update Zobrist Hash ---
    nextHash = togglePieceKeyBB(nextHash, movingPieceTypeIndex, fromIndex);
    if (isCapture && capturedPieceTypeIndex !== null) { // Use the validated index
        nextHash = togglePieceKeyBB(nextHash, capturedPieceTypeIndex, toIndex);
    }
    nextHash = togglePieceKeyBB(nextHash, movingPieceTypeIndex, toIndex);
    nextHash = toggleTurnKey(nextHash);

    // --- Determine Next State Properties ---
    const nextPlayer = opponent;
    let nextGameOver = false;
    let nextWinner = null;

    // Check win conditions based on the new state (Den entry checked earlier)
    if (isMovingToOpponentDen && !isTargetOccupiedByOpponent) {
        // We already validated this isn't an illegal hungry move above
        nextGameOver = true;
        nextWinner = currentPlayer;
    }
    if (!nextGameOver) { // Check elimination
        if (nextBitboards[opponentBBIndex] === BB_EMPTY) {
            nextGameOver = true;
            nextWinner = currentPlayer;
        } else if (nextBitboards[playerBBIndex] === BB_EMPTY) {
            nextGameOver = true;
            nextWinner = opponent;
        }
    }

    // --- Return Result ---
    return {
        nextBitboards: nextBitboards,
        nextPlayer: nextPlayer,
        nextHash: nextHash,
        nextGameOver: nextGameOver,
        nextWinner: nextWinner,
        capturedPieceTypeIndex: capturedPieceTypeIndex // null if no capture
    };
}

// --- Move Execution ---

/**
 * Executes a validated move, updating the main `gameState`. Integrates starvation and hungry declaration.
 * Handles bitboard updates, Zobrist hash updates (including hungry state), turn switching,
 * and updates the logical move history (gameState.moveHistory).
 * Checks for game end conditions (den entry, elimination, stalemate).
 * *** Does NOT directly interact with UI or History (caller handles UI updates & saveGameState). ***
 * Depends on: gameState, getPieceData, isValidMoveBB, simulateMoveBB, checkForStalemateBB,
 *             declareHungryAnimalsBB, checkAndApplyStarvationBB,
 *             PLAYERS, BB_IDX, RANK_TO_CODE (constants.js), BB_EMPTY (bitboardUtils.js),
 *             coordToBitIndex, getBit, clearBit, lsbIndex, bitIndexToCoord, toggleHungryKeyBB (gameState.js).
 * Modifies: gameState.
 *
 * @param {string} fromCoords - The starting coordinates of the move.
 * @param {string} toCoords - The ending coordinates of the move.
 * @returns {{
 *   success: boolean,
 *   reason?: string,
 *   notation?: string,
 *   capturedPieceTypeIndex?: number|null,
 *   starvedPiecesCoords?: string[],
 *   declaredHungryMap?: object, // { coords: true }
 *   isGameOver?: boolean,
 *   winner?: string|null,
 *   playerWhoMoved?: string,
 *   turnNumber?: number
 * } | null} An object describing the result of the move attempt, or null if initial validation fails badly.
 */
function performMoveBB(fromCoords, toCoords) {
    const fnName = "performMoveBB";

    // --- Initial Checks ---
    if (gameState.gameOver) { return { success: false, reason: "Game is already over." }; }
    const movingPieceData = getPieceData(fromCoords);
    if (!movingPieceData || movingPieceData.player !== gameState.currentPlayer) {
        // console.error(`[${fnName}] Error: Cannot move piece at ${fromCoords}. Data:`, movingPieceData, `Current Player: ${gameState.currentPlayer}`);
        return { success: false, reason: `Cannot move piece at ${fromCoords}.` };
    }

    const fromIndex = coordToBitIndex(fromCoords);
    const toIndex = coordToBitIndex(toCoords);
    const movingPieceTypeIndex = getPieceTypeIndex(movingPieceData.player, movingPieceData.rank);

    if (fromIndex === -1 || toIndex === -1 || movingPieceTypeIndex === -1) {
        console.error(`[${fnName}] Error: Invalid coordinate or piece index for move ${fromCoords}->${toCoords}.`);
        return { success: false, reason: "Internal error: Invalid move indices." };
    }

    // --- Validate Move Legality ---
    const validationResult = isValidMoveBB(fromIndex, toIndex, movingPieceTypeIndex, gameState.currentPlayer, gameState.bitboards);
    if (!validationResult.valid) {
        return { success: false, reason: validationResult.reason };
    }

    // --- Get info before modifying state ---
    const playerWhoMoved = gameState.currentPlayer;
    const turnNumberForLog = gameState.turnNumber; // Capture turn number *before* potential increment
    const hungryBBAtTurnStart = gameState.hungryBB[playerWhoMoved];
    let currentBitboards = [...gameState.bitboards]; // Use copies for checks before modification
    let currentHash = gameState.zobristHash;       // Use current hash
    let notation = `${RANK_TO_CODE[movingPieceData.rank]}`; // Start building notation

    // --- Check Repetition Rule Before Move ---
    // Simulate the move simply to get the hash *after* piece movement and turn toggle.
    // This hash does NOT include starvation or hunger updates yet.
    const simResultForRepCheck = simulateMoveBB(currentBitboards, playerWhoMoved, currentHash, { from: fromCoords, to: toCoords, pieceTypeIndex: movingPieceTypeIndex });

    if (!simResultForRepCheck) {
        // If simulation fails (e.g., hungry den entry), the move is illegal anyway.
        console.warn(`[${fnName} RepCheck] Simulation failed for ${fromCoords}->${toCoords}, move likely invalid.`);
        // Let the main execution path handle the failure reason if needed.
        // No need to block based on repetition if the move simulation itself fails.
    } else {
        const nextHashForRepCheck = simResultForRepCheck.nextHash; // Hash after move+turn toggle
        const repetitionCount = gameState.boardStateHistory[nextHashForRepCheck.toString()] || 0;

        // Check if the resulting position (ignoring hunger changes for the check) is repeated >= 2 times
        if (repetitionCount >= 2) {
            const { orange: orangeCount, yellow: yellowCount } = getPieceCountsBB(currentBitboards); // Use current piece counts
            const restrictedPlayer = getRestrictedPlayer(orangeCount, yellowCount);
            if (playerWhoMoved === restrictedPlayer) {
                console.log(`[${fnName}] Illegal move: ${fromCoords}->${toCoords} violates repetition rule for ${playerWhoMoved}.`);
                return { success: false, reason: "Move violates repetition rule (3-fold repetition)." };
            }
        }
    }
    // --- Repetition check passed or simulation failed, proceed with actual move execution ---

    // Re-fetch state again as we start the actual modification process
    currentBitboards = [...gameState.bitboards];
    currentHash = gameState.zobristHash;

    // --- Check for Attack (Needed for starvation) ---
    const opponentBBIndex = playerWhoMoved === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
    const isAttack = getBit(currentBitboards[opponentBBIndex], toIndex) !== 0n;
    let capturedPieceTypeIndexAtTarget = null;
    if (isAttack) {
        notation += 'x'; // Add to notation early
        const opponentTypeStart = playerWhoMoved === PLAYERS.ORANGE ? Y_RAT_IDX : BB_IDX.PIECE_START;
        const opponentTypeEnd = playerWhoMoved === PLAYERS.ORANGE ? BB_IDX.PIECE_END : O_ELEPHANT_IDX;
        for (let oppTypeIdx = opponentTypeStart; oppTypeIdx <= opponentTypeEnd; oppTypeIdx++) {
            if (getBit(currentBitboards[oppTypeIdx], toIndex) !== 0n) {
                capturedPieceTypeIndexAtTarget = oppTypeIdx;
                break;
            }
        }
        if (capturedPieceTypeIndexAtTarget === null) {
            console.error(`[${fnName}] Inconsistency: Attack detected at ${toCoords} but captured piece type not found in current state.`);
            return { success: false, reason: "Internal error: Cannot identify captured piece." };
        }
    }

    // --- Apply Starvation (to actual game state) ---
    const starvationResult = checkAndApplyStarvationBB(playerWhoMoved, fromCoords, isAttack, hungryBBAtTurnStart, currentBitboards, currentHash);
    const starvedPiecesCoords = starvationResult.starvedPiecesCoords;
    currentBitboards = starvationResult.modifiedBitboards; // Update boards state
    currentHash = starvationResult.modifiedHash;          // Update hash state

    // --- Check if the moving piece itself was starved ---
    if (starvedPiecesCoords.includes(fromCoords)) {
        console.log(`[${fnName}] Move ${fromCoords}->${toCoords} invalidated: moving piece was starved.`);
        // --- Logic for starved moving piece (Updates actual gameState hash including hunger changes) ---
        const oldHungryForMovedPlayer = gameState.hungryBB[playerWhoMoved];
        let tempClearedBB = oldHungryForMovedPlayer;
        while (tempClearedBB !== BB_EMPTY) {
             const lsb = lsbIndex(tempClearedBB);
             if (lsb === -1) break;
             currentHash = toggleHungryKeyBB(currentHash, playerWhoMoved, lsb);
             tempClearedBB = clearBit(tempClearedBB, lsb);
        }
        gameState.hungryBB[playerWhoMoved] = BB_EMPTY; // Update actual hungry state

        const nextPlayerAfterStarve = playerWhoMoved === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
        gameState.currentPlayer = nextPlayerAfterStarve;
        currentHash = toggleTurnKey(currentHash); // Toggle turn hash

        gameState.bitboards = currentBitboards; // Store post-starvation boards
        gameState.zobristHash = currentHash; // Store hash before opponent hunger declaration

        const declaredHungryMap = declareHungryAnimalsBB(nextPlayerAfterStarve, currentBitboards); // Updates opponent hungryBB & hash internally
        currentHash = gameState.zobristHash; // Refresh hash AFTER declaration
        // const hungryCount = Object.keys(declaredHungryMap).length; // Not needed for notation here

        gameState.playerLastMoves[playerWhoMoved] = { from: fromCoords, to: 'STARVED' };
        if (playerWhoMoved === PLAYERS.YELLOW) gameState.turnNumber++; // Increment turn even if starved

        // Log the final state hash AFTER all updates
        const hashStringAfterStarve = gameState.zobristHash.toString();
        gameState.boardStateHistory[hashStringAfterStarve] = (gameState.boardStateHistory[hashStringAfterStarve] || 0) + 1;

        // --- Update Move History for Starved Case ---
        const starvedNotation = `${fromCoords}-STARVED`; // Special notation for log history
        const currentTurnLogForStarve = gameState.moveHistory.get(turnNumberForLog) || { turn: turnNumberForLog, orange: null, yellow: null };
        currentTurnLogForStarve[playerWhoMoved] = starvedNotation;
        gameState.moveHistory.set(turnNumberForLog, currentTurnLogForStarve);
        // --- End History Update ---

        // Check Game End
        let finalGameOver = false;
        let finalWinner = null;
        const opponentBBIndexAfterStarve = playerWhoMoved === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;
        const playerBBIndexAfterStarve = playerWhoMoved === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;
        if (gameState.bitboards[opponentBBIndexAfterStarve] === BB_EMPTY) {
            finalGameOver = true;
            finalWinner = playerWhoMoved;
        } else if (gameState.bitboards[playerBBIndexAfterStarve] === BB_EMPTY) {
            finalGameOver = true;
            finalWinner = nextPlayerAfterStarve;
        }
        if (!finalGameOver) {
            const isStalemate = checkForStalemateBB(nextPlayerAfterStarve, gameState.bitboards);
            if (isStalemate) {
                finalGameOver = true;
                finalWinner = null;
            }
         }
        gameState.gameOver = finalGameOver;
        gameState.winner = finalWinner;

        return { // Return failure, but include starvation details
            success: false,
            reason: "Move invalidated: moving piece was starved.",
            notation: starvedNotation, // Include the special notation here too
            starvedPiecesCoords: starvedPiecesCoords,
            declaredHungryMap: declaredHungryMap,
            isGameOver: finalGameOver,
            winner: finalWinner,
            playerWhoMoved: playerWhoMoved,
            turnNumber: turnNumberForLog
        };
    }

    // --- Simulate the main move on the (potentially starved) state (Actual move) ---
    const simResult = simulateMoveBB(currentBitboards, playerWhoMoved, currentHash, { from: fromCoords, to: toCoords, pieceTypeIndex: movingPieceTypeIndex });
    if (!simResult) {
        console.error(`[${fnName}] Critical Error: Simulation failed for move ${fromCoords}->${toCoords} AFTER starvation checks.`);
        // This case should ideally be caught by isValidMoveBB earlier unless simulateMoveBB has extra checks
        return { success: false, reason: "Internal error during final move simulation after starvation." };
    }

    // --- Apply Actual Move Results to Global Game State ---
    gameState.bitboards = simResult.nextBitboards;
    currentHash = simResult.nextHash; // Hash now includes move + turn toggle
    gameState.playerLastMoves[playerWhoMoved] = { from: fromCoords, to: toCoords };

    // --- Clear Previous Hungry State for Player Who Moved (Actual state update) ---
    const oldHungryForMovedPlayer = gameState.hungryBB[playerWhoMoved];
    let tempClearedBB = oldHungryForMovedPlayer;
    while (tempClearedBB !== BB_EMPTY) {
         const lsb = lsbIndex(tempClearedBB);
         if (lsb === -1) break;
         currentHash = toggleHungryKeyBB(currentHash, playerWhoMoved, lsb); // Update hash
         tempClearedBB = clearBit(tempClearedBB, lsb);
    }
    gameState.hungryBB[playerWhoMoved] = BB_EMPTY; // Update actual hungry state

    // --- Update Current Player ---
    gameState.currentPlayer = simResult.nextPlayer;

    // --- Finish Building Notation String ---
    notation += toCoords; // Add destination
    if (starvedPiecesCoords.length > 0) {
        notation += 'S'.repeat(starvedPiecesCoords.length); // Use 'S' for starved in notation
    }

    // --- Declare Hungry Animals for the *Next* Player (Actual state update) ---
    gameState.zobristHash = currentHash; // Store hash *before* declaration
    const declaredHungryMap = declareHungryAnimalsBB(gameState.currentPlayer, gameState.bitboards); // Updates opponent hungryBB & hash internally
    currentHash = gameState.zobristHash; // Refresh hash *after* declaration updated it
    const hungryCount = Object.keys(declaredHungryMap).length;
    if (hungryCount > 0) {
        notation += '+'.repeat(hungryCount); // Add hungry indicators
    }

    // --- Update Turn Number ---
    if (playerWhoMoved === PLAYERS.YELLOW) {
        gameState.turnNumber++;
    }

    // --- Log Board State for Repetition (Actual state logging) ---
    // The hash stored here now correctly includes all side effects: starvation, move, turn, hunger clear, hunger declare.
    const finalHashString = currentHash.toString();
    gameState.boardStateHistory[finalHashString] = (gameState.boardStateHistory[finalHashString] || 0) + 1;

    // --- Update Move History ---
    // Get or create the entry for the current turn number
    const currentTurnLog = gameState.moveHistory.get(turnNumberForLog) || { turn: turnNumberForLog, orange: null, yellow: null };
    // Add the generated notation for the player who moved
    currentTurnLog[playerWhoMoved] = notation;
    // Store it back in the Map
    gameState.moveHistory.set(turnNumberForLog, currentTurnLog);
    // --- End History Update ---


    // --- Check Post-Move Game End Conditions ---
    let finalGameOver = simResult.nextGameOver;
    let finalWinner = simResult.nextWinner;
    if (!finalGameOver) {
        const isStalemate = checkForStalemateBB(gameState.currentPlayer, gameState.bitboards);
        if (isStalemate) {
            finalGameOver = true;
            finalWinner = null;
        }
    }

    // --- Finalize Game State ---
    gameState.gameOver = finalGameOver;
    gameState.winner = finalWinner;
    gameState.zobristHash = currentHash; // Store final actual hash

    // --- Return Result Object ---
    return {
        success: true,
        notation: notation, // Return the fully constructed notation
        capturedPieceTypeIndex: capturedPieceTypeIndexAtTarget,
        starvedPiecesCoords: starvedPiecesCoords,
        declaredHungryMap: declaredHungryMap,
        isGameOver: finalGameOver,
        winner: finalWinner,
        playerWhoMoved: playerWhoMoved,
        turnNumber: turnNumberForLog // Return the turn number when the move started
    };
}

/**
 * Checks if the specified player has any valid moves available, considering repetition rules.
 * Iterates through pseudo-legal moves, performs full validation, and checks repetition constraints.
 * Depends on: getAllValidMovesBB, isValidMoveBB, simulateMoveBB, getPieceCountsBB,
 *             getRestrictedPlayer, gameState (for boardStateHistory, hungryBB), computeZobristHashBB,
 *             coordToBitIndex (bitboardUtils.js).
 *
 * @param {string} playerToCheck - The player ('orange' or 'yellow') whose turn it would be.
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @returns {boolean} True if the player has no valid moves (stalemate), false otherwise.
 */
function checkForStalemateBB(playerToCheck, bitboards) {
    // Generate all pseudo-legal moves first
    const possibleMoves = getAllValidMovesBB(bitboards, playerToCheck, true); // Use simulation flag

    // If no geometrically possible moves exist, it's stalemate
    if (possibleMoves.length === 0) {
        return true;
    }

    // Get the hash of the current position *including the current hungry state*
    const currentHash = computeZobristHashBB(bitboards, playerToCheck, gameState.hungryBB);

    // Check if ANY pseudo-legal move is actually fully legal (passes validation AND repetition)
    for (const move of possibleMoves) {
        const fromIdx = coordToBitIndex(move.from);
        const toIdx = coordToBitIndex(move.to);

        if (fromIdx === -1 || toIdx === -1 || typeof move.pieceTypeIndex !== 'number') continue; // Skip invalid move objects

        // 1. Check basic validity (rank, terrain, geometry, hungry den entry etc.)
        const validation = isValidMoveBB(fromIdx, toIdx, move.pieceTypeIndex, playerToCheck, bitboards);
        if (!validation.valid) {
            continue; // Basic validation failed, try next move
        }

        // 2. Check repetition validity for this specific move
        // Simulate move needs the hash *before* the move
        const simResult = simulateMoveBB(bitboards, playerToCheck, currentHash, move);
        if (!simResult) {
             // Should not happen if basic validation passed, but check anyway
             // Treat simulation failure (likely illegal hungry den entry) as invalid move
             continue;
        }

        const nextHashKey = simResult.nextHash.toString();
        const nextRepetitionCount = gameState.boardStateHistory[nextHashKey] || 0;
        let moveIsIllegalRepetition = false;

        if (nextRepetitionCount >= 2) {
            const { orange: oc, yellow: yc } = getPieceCountsBB(bitboards);
            const restrictedPlayer = getRestrictedPlayer(oc, yc);
            if (playerToCheck === restrictedPlayer) {
                moveIsIllegalRepetition = true;
            }
        }

        // If the move is valid AND not an illegal repetition, then the player is NOT stalemated
        if (!moveIsIllegalRepetition) {
            return false; // Found at least one fully legal move
        }
    }

    // If the loop completes without finding any fully legal move
    return true;
}

/**
 * Identifies pieces of the specified player that can make a valid capture in the current state.
 * Updates the corresponding hungryBB in the global gameState AND updates the Zobrist hash.
 * Depends on: getAllValidMovesBB, isValidMoveBB, getBit, lsbIndex, clearBit, bitIndexToCoord,
 *             coordToBitIndex (bitboardUtils.js), BB_IDX, PLAYERS (constants.js),
 *             BB_EMPTY (bitboardUtils.js), gameState, toggleHungryKeyBB (gameState.js).
 * Modifies: gameState.hungryBB, gameState.zobristHash.
 *
 * @param {string} playerToDeclareFor - The player ('orange' or 'yellow') whose pieces' hunger state to update.
 * @param {bigint[]} currentBitboards - The current bitboard state array.
 * @returns {object} A map `{ coords: true }` for each piece newly declared hungry (for UI/logging).
 */
function declareHungryAnimalsBB(playerToDeclareFor, currentBitboards) {
    const fnName = "declareHungryAnimalsBB";
    let newHungryBBforPlayer = BB_EMPTY;
    const newlyHungryMap = {}; // For return value
    const opponent = playerToDeclareFor === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const opponentBBIndex = playerToDeclareFor === PLAYERS.ORANGE ? BB_IDX.YELLOW_PIECES : BB_IDX.ORANGE_PIECES;

    if (!currentBitboards || !gameState || !gameState.hungryBB) { // Check gameState existence
        console.error(`[${fnName}] Error: Invalid bitboards or gameState missing.`);
        return newlyHungryMap;
    }
    const opponentPiecesBB = currentBitboards[opponentBBIndex];
    const oldHungryBBforPlayer = gameState.hungryBB[playerToDeclareFor]; // Get OLD state for hash diff

    // Optimization: Generate all valid moves for the player once
    let allPlayerMoves = [];
    try {
        // Use simulation flag true for potentially faster pseudo-move generation
        allPlayerMoves = getAllValidMovesBB(currentBitboards, playerToDeclareFor, true);
    } catch (e) {
        console.error(`[${fnName}] Error generating moves for ${playerToDeclareFor}:`, e);
    }

    // Iterate through each piece type for the player
    const pieceTypeStart = playerToDeclareFor === PLAYERS.ORANGE ? BB_IDX.PIECE_START : Y_RAT_IDX;
    const pieceTypeEnd = playerToDeclareFor === PLAYERS.ORANGE ? O_ELEPHANT_IDX : BB_IDX.PIECE_END;

    for (let pieceTypeIndex = pieceTypeStart; pieceTypeIndex <= pieceTypeEnd; pieceTypeIndex++) {
        let pieceBoard = currentBitboards[pieceTypeIndex];

        while (pieceBoard !== BB_EMPTY) {
            const fromIndex = lsbIndex(pieceBoard);
            if (fromIndex === -1) break;
            //const fromCoords = bitIndexToCoord(fromIndex); // Coords only needed if logging

            let canMakeValidCapture = false;
            // Filter pre-generated moves for the current piece
            const pieceMoves = allPlayerMoves.filter(m => coordToBitIndex(m.from) === fromIndex);

            for (const move of pieceMoves) {
                const toIndex = coordToBitIndex(move.to);

                // Is it targeting an opponent piece?
                if (toIndex !== -1 && getBit(opponentPiecesBB, toIndex) !== 0n) {
                    // Is the capture actually valid (rank, traps etc)?
                    const validation = isValidMoveBB(fromIndex, toIndex, pieceTypeIndex, playerToDeclareFor, currentBitboards);
                    if (validation.valid) {
                        canMakeValidCapture = true;
                        break; // Found a valid capture for this piece
                    }
                }
            }

            if (canMakeValidCapture) {
                newHungryBBforPlayer = setBit(newHungryBBforPlayer, fromIndex);
                const coords = bitIndexToCoord(fromIndex); // Get coords only if needed for map
                if (coords) newlyHungryMap[coords] = true;
            }

            pieceBoard = clearBit(pieceBoard, fromIndex); // Move to next piece of this type
        }
    }

    // --- Update Zobrist Hash based on the difference ---
    const changedBits = oldHungryBBforPlayer ^ newHungryBBforPlayer; // Find bits that flipped
    let tempChangedBB = changedBits;
    while (tempChangedBB !== BB_EMPTY) {
        const lsb = lsbIndex(tempChangedBB);
        if (lsb === -1) break;
        // Toggle the hash for each changed square
        gameState.zobristHash = toggleHungryKeyBB(gameState.zobristHash, playerToDeclareFor, lsb);
        tempChangedBB = clearBit(tempChangedBB, lsb);
    }
    // --- End Zobrist Update ---

    // Update the global game state's hungry board for this player AFTER updating hash
    gameState.hungryBB[playerToDeclareFor] = newHungryBBforPlayer;

    return newlyHungryMap;
}

/**
 * Checks if hungry pieces (from the start of the turn) failed to capture and removes them.
 * Modifies the passed bitboards and hash directly. **Assumes Zobrist hashing for hungry state is NOT used.**
 * Depends on: getBit, clearBit, lsbIndex, bitIndexToCoord (bitboardUtils.js),
 *             togglePieceKeyBB (gameState.js - only for piece removal),
 *             coordToBitIndex, BB_IDX, PLAYERS (constants.js).
 *
 * @param {string} playerWhoMoved - The player who just completed their move.
 * @param {string} movedPieceFromCoords - The starting coords of the piece that just moved. Can be null if move wasn't by a piece (e.g., hypothetical future scenarios).
 * @param {boolean} wasAttack - True if the move performed was a capture.
 * @param {bigint} hungryBBAtTurnStart - The hungry bitboard for playerWhoMoved *before* their turn began.
 * @param {bigint[]} currentBitboards - The current bitboard state array (will be modified).
 * @param {bigint} currentHash - The current Zobrist hash (will be modified).
 * @returns {{ starvedPiecesCoords: string[], modifiedBitboards: bigint[], modifiedHash: bigint }} Result object.
 */
function checkAndApplyStarvationBB(playerWhoMoved, movedPieceFromCoords, wasAttack, hungryBBAtTurnStart, currentBitboards, currentHash) {
    const fnName = "checkAndApplyStarvationBB";
    const starvedPiecesCoords = [];
    let tempHungryBB = hungryBBAtTurnStart; // Work on the input BB state
    let modifiedBitboards = [...currentBitboards]; // Copy to modify
    let modifiedHash = currentHash;
    const movedPieceFromIndex = movedPieceFromCoords ? coordToBitIndex(movedPieceFromCoords) : -1; // Handle null coords

    while (tempHungryBB !== BB_EMPTY) {
        const hungryIndex = lsbIndex(tempHungryBB);
        if (hungryIndex === -1) break;

        const hungryCoords = bitIndexToCoord(hungryIndex);

        // Check if this specific hungry piece made the capturing move
        const didThisPieceAttack = (hungryIndex === movedPieceFromIndex) && wasAttack;

        if (!didThisPieceAttack) {
            // This hungry piece did NOT make a capturing move -> STARVE
            if (hungryCoords) {
                 console.log(`STARVE: ${playerWhoMoved} piece at ${hungryCoords} (idx ${hungryIndex}) was hungry but did not attack.`);
                 starvedPiecesCoords.push(hungryCoords);

                 // Find piece type to remove
                 let starvedPieceTypeIndex = -1;
                 for (let typeIdx = BB_IDX.PIECE_START; typeIdx <= BB_IDX.PIECE_END; typeIdx++) {
                     // Check the *copied* bitboards we intend to modify
                     if (getBit(modifiedBitboards[typeIdx], hungryIndex) !== 0n) {
                         starvedPieceTypeIndex = typeIdx;
                         break;
                     }
                 }

                 if (starvedPieceTypeIndex !== -1) {
                    // Remove from bitboards (modifying the copied array)
                    modifiedBitboards[starvedPieceTypeIndex] = clearBit(modifiedBitboards[starvedPieceTypeIndex], hungryIndex);
                    const playerBBIndex = playerWhoMoved === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;
                    modifiedBitboards[playerBBIndex] = clearBit(modifiedBitboards[playerBBIndex], hungryIndex);
                    // Occupied board will be fully recalculated later

                    // Update hash for the removed piece
                    modifiedHash = togglePieceKeyBB(modifiedHash, starvedPieceTypeIndex, hungryIndex);
                 } else {
                     console.error(`[${fnName}] Error: Could not find piece type for starving piece at ${hungryCoords} (index ${hungryIndex})`);
                 }
            }
        }

        // Remove this piece from the temporary hungry board to process next
        tempHungryBB = clearBit(tempHungryBB, hungryIndex);
    }

    // Recalculate occupied board fully after all potential removals
    modifiedBitboards[BB_IDX.OCCUPIED] = modifiedBitboards[BB_IDX.ORANGE_PIECES] | modifiedBitboards[BB_IDX.YELLOW_PIECES];


    return { starvedPiecesCoords, modifiedBitboards, modifiedHash };
}


// --- Export (if using modules) ---
// export { performMoveBB, isValidMoveBB, getAllValidMovesBB, ... };
