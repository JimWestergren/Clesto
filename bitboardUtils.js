/**
 * @fileoverview Utilities for handling bitboards, coordinate mapping,
 * terrain masks, and jump path calculations in the Clesto game.
 */

// --- Bitboard Mapping & Terrain State (Initialized Lazily or Explicitly) ---

/**
 * Cache mapping bit indices (0-62) to algebraic coordinates ('a9'-'g1').
 * Initialized by initializeBitboardCoordMapping.
 * @type {Array<string|undefined>} - Size 64, indices 0-62 used.
 */
const bitIndexToCoordCache = new Array(64);

/**
 * Cache mapping algebraic coordinates ('a9'-'g1') to bit indices (0-62).
 * Initialized by initializeBitboardCoordMapping.
 * @type {Object.<string, number>}
 */
const coordToBitIndexCache = {};

/** Static bitboard representing water squares. Initialized by initializeTerrainBitboards. @type {bigint} */
let waterBB = BB_EMPTY;
/** Static bitboard representing trap squares near Yellow's den (affect Yellow pieces). Initialized by initializeTerrainBitboards. @type {bigint} */
let orangeTrapBB = BB_EMPTY;
/** Static bitboard representing trap squares near Orange's den (affect Orange pieces). Initialized by initializeTerrainBitboards. @type {bigint} */
let yellowTrapBB = BB_EMPTY;
/** Static bitboard representing all trap squares. Initialized by initializeTerrainBitboards. @type {bigint} */
let allTrapsBB = BB_EMPTY;
/** Static bitboard representing Orange's den square. Initialized by initializeTerrainBitboards. @type {bigint} */
let orangeDenBB = BB_EMPTY;
/** Static bitboard representing Yellow's den square. Initialized by initializeTerrainBitboards. @type {bigint} */
let yellowDenBB = BB_EMPTY;

/** Static bitboard representing the center columns (C, D, E). Initialized by initializePositionalMasks. @type {bigint} */
let centerColsBB = BB_EMPTY;
/** Static bitboard representing squares Orange needs to cross to advance (Rows 5-9). Initialized by initializePositionalMasks. @type {bigint} */
let orangeAdvanceBB = BB_EMPTY;
/** Static bitboard representing squares Yellow needs to cross to advance (Rows 1-4). Initialized by initializePositionalMasks. @type {bigint} */
let yellowAdvanceBB = BB_EMPTY;

/**
 * Stores pre-calculated bitmasks for water squares between jump start/end points.
 * Key: 'fromIdx-toIdx', Value: bigint mask.
 * Initialized by initializeJumpMasks.
 * @type {Object.<string, bigint>}
 */
const jumpPathMasks = {};

// --- Basic Bitboard Operations ---

/**
 * Sets a specific bit in a BigInt bitboard.
 * @param {bigint} bb The bitboard.
 * @param {number} index The bit index (0-63).
 * @returns {bigint} The updated bitboard. Returns original bb if index is out of bounds.
 */
function setBit(bb, index) {
    // Check bounds (0-62 for Clesto board, but allow up to 63 for standard 64-bit operations)
    if (index < 0 || index > 63) {
        return bb;
    }
    return bb | (1n << BigInt(index));
}

/**
 * Clears a specific bit in a BigInt bitboard.
 * @param {bigint} bb The bitboard.
 * @param {number} index The bit index (0-63).
 * @returns {bigint} The updated bitboard. Returns original bb if index is out of bounds.
 */
function clearBit(bb, index) {
    if (index < 0 || index > 63) {
        return bb;
    }
    return bb & ~(1n << BigInt(index));
}

/**
 * Gets the value of a specific bit in a BigInt bitboard.
 * @param {bigint} bb The bitboard.
 * @param {number} index The bit index (0-63).
 * @returns {bigint} 1n if the bit is set, 0n otherwise. Returns 0n if index is out of bounds.
 */
function getBit(bb, index) {
    if (index < 0 || index > 63) {
        return 0n;
    }
    return (bb >> BigInt(index)) & 1n;
}

/**
 * Counts the number of set bits (population count) in a BigInt using Brian Kernighan's algorithm.
 * @param {bigint} bb The bitboard.
 * @returns {number} The number of set bits.
 */
function popcount(bb) {
    let count = 0;
    let tempBB = bb;
    while (tempBB > 0n) {
        tempBB &= (tempBB - 1n); // Clears the least significant bit set
        count++;
    }
    return count;
}

/**
 * Finds the index of the least significant bit (LSB) set in a BigInt.
 * Returns -1 if the bitboard is empty.
 * Uses a simple loop, can be optimized further if needed.
 * @param {bigint} bb The bitboard.
 * @returns {number} The index (0-63) of the LSB, or -1 if empty.
 */
function lsbIndex(bb) {
    if (bb === 0n) return -1;
    let index = 0;
    // Check lower 32 bits first for potential speedup
    if ((bb & 0xFFFFFFFFn) === 0n) {
        bb >>= 32n;
        index += 32;
    }
    // Check lower 16 bits of the remaining
    if ((bb & 0xFFFFn) === 0n) {
        bb >>= 16n;
        index += 16;
    }
    // Check lower 8 bits
    if ((bb & 0xFFn) === 0n) {
        bb >>= 8n;
        index += 8;
    }
    // Check lower 4 bits
    if ((bb & 0xFn) === 0n) {
        bb >>= 4n;
        index += 4;
    }
    // Check lower 2 bits
    if ((bb & 0x3n) === 0n) {
        bb >>= 2n;
        index += 2;
    }
    // Check lowest bit
    if ((bb & 0x1n) === 0n) {
        // This condition implies the LSB is the second bit (index + 1)
        // as the lowest bit (index + 0) was zero.
        index += 1;
    }
    // Final bound check (shouldn't exceed 63 if input bb was non-zero)
    return index < 64 ? index : -1;
}


// --- Coordinate Mapping ---

/**
 * Initializes the coordinate-to-bit-index mapping and vice-versa.
 * Uses A9=0, B9=1, ..., G9=6, A8=7, ..., G1=62 convention.
 * Populates `coordToBitIndexCache` and `bitIndexToCoordCache`.
 * Should be called once at application start.
 * Depends on: getCoords (utils.js), ROWS, COLS, SQUARES (constants.js).
 */
function initializeBitboardCoordMapping() {
    // Check if already initialized by looking at a known key
    if (coordToBitIndexCache['a9'] === 0) return;

    console.log("Initializing Bitboard Coordinate Mapping...");
    let index = 0;
    for (let r = 0; r < ROWS; r++) { // 0 (Row 9) to 8 (Row 1)
        for (let c = 0; c < COLS; c++) { // 0 (Col A) to 6 (Col G)
            const coords = getCoords(r, c); // Gets 'a9' for r=0, c=0
            if (coords) {
                if (index < SQUARES) { // Use SQUARES constant
                    coordToBitIndexCache[coords] = index;
                    bitIndexToCoordCache[index] = coords;
                    index++;
                } else {
                    console.error(`Bitboard mapping error: Exceeded expected squares count ${SQUARES}! Index: ${index}`);
                    return; // Stop initialization on error
                }
            }
        }
    }
    if (index !== SQUARES) {
        console.error(`Bitboard Map Init Error: Expected ${SQUARES} squares, mapped ${index}.`);
    } else {
        console.log("Bitboard Coordinate Mapping Initialized.");
    }
}

/**
 * Converts algebraic coordinates to a bit index (0-62).
 * Uses the pre-populated cache. Returns -1 if invalid or not initialized.
 * @param {string} coords Algebraic coordinates (e.g., 'a9', 'g1').
 * @returns {number} The bit index (0-62) or -1.
 */
function coordToBitIndex(coords) {
    // Lazy initialization check (optional, depends on calling context)
    // if (Object.keys(coordToBitIndexCache).length === 0) {
    //    initializeBitboardCoordMapping();
    // }
    const index = coordToBitIndexCache[coords];
    // Return -1 if coords is not a key or the value is not a number
    return (typeof index === 'number') ? index : -1;
}

/**
 * Converts a bit index (0-62) back to algebraic coordinates.
 * Uses the pre-populated cache. Returns null if invalid or not initialized.
 * @param {number} index The bit index (0-62).
 * @returns {string|null} The algebraic coordinates or null.
 */
function bitIndexToCoord(index) {
    // Lazy initialization check (optional)
    // if (!bitIndexToCoordCache[0]) { // Check if index 0 is populated
    //     initializeBitboardCoordMapping();
    // }
    // Check bounds (0-62) using SQUARES constant
    if (index < 0 || index >= SQUARES) return null;
    return bitIndexToCoordCache[index] || null; // Return cached value or null if undefined
}


// --- Terrain and Positional Masks Initialization ---

/**
 * Initializes the static terrain bitboards (water, traps, dens).
 * MUST be called after initializeBitboardCoordMapping.
 * Depends on: WATER_SQUARES, TRAPS, DENS (constants.js), coordToBitIndex, setBit.
 */
function initializeTerrainBitboards() {
    if (waterBB !== BB_EMPTY) return; // Already initialized

    console.log("Initializing Terrain Bitboards...");

    // Water
    WATER_SQUARES.forEach(coords => {
        const index = coordToBitIndex(coords);
        if (index !== -1) waterBB = setBit(waterBB, index);
        else console.warn(`Terrain Init Warning: Invalid coord "${coords}" in WATER_SQUARES`);
    });

    // Traps near Yellow Den (affect Yellow pieces)
    TRAPS.orange.forEach(coords => {
        const index = coordToBitIndex(coords);
        if (index !== -1) orangeTrapBB = setBit(orangeTrapBB, index);
        else console.warn(`Terrain Init Warning: Invalid coord "${coords}" in TRAPS.orange`);
    });

    // Traps near Orange Den (affect Orange pieces)
    TRAPS.yellow.forEach(coords => {
        const index = coordToBitIndex(coords);
        if (index !== -1) yellowTrapBB = setBit(yellowTrapBB, index);
        else console.warn(`Terrain Init Warning: Invalid coord "${coords}" in TRAPS.yellow`);
    });

    // Combined Traps
    allTrapsBB = orangeTrapBB | yellowTrapBB;

    // Dens
    const oDenIdx = coordToBitIndex(DENS.orange);
    if (oDenIdx !== -1) orangeDenBB = setBit(orangeDenBB, oDenIdx);
    else console.error(`Terrain Init Error: Invalid Orange Den coord "${DENS.orange}"`);

    const yDenIdx = coordToBitIndex(DENS.yellow);
    if (yDenIdx !== -1) yellowDenBB = setBit(yellowDenBB, yDenIdx);
    else console.error(`Terrain Init Error: Invalid Yellow Den coord "${DENS.yellow}"`);

    console.log("Terrain Bitboards Initialized.");
}

/**
 * Initializes static positional bitmasks (center columns, advance zones).
 * MUST be called after initializeBitboardCoordMapping.
 * Depends on: ROWS, COLS, SQUARES (constants.js), getCoords, coordToBitIndex, setBit.
 */
function initializePositionalMasks() {
    if (centerColsBB !== BB_EMPTY) return; // Already initialized
    console.log("Initializing Positional Masks...");

    // Center Columns (C=2, D=3, E=4)
    for (let r = 0; r < ROWS; r++) {
        for (let c = 2; c <= 4; c++) {
            const coords = getCoords(r, c);
            if(coords) {
                const idx = coordToBitIndex(coords);
                if (idx !== -1) centerColsBB = setBit(centerColsBB, idx);
            }
        }
    }

    // Orange Advance Zone (Rows 5-9 => Indices 0-34)
    // Row 9 (indices 0-6), Row 8 (7-13), Row 7 (14-20), Row 6 (21-27), Row 5 (28-34)
    for (let idx = 0; idx < 35; idx++) {
        orangeAdvanceBB = setBit(orangeAdvanceBB, idx);
    }

    // Yellow Advance Zone (Rows 1-4 => Indices 35-62)
    // Row 4 (indices 35-41), Row 3 (42-48), Row 2 (49-55), Row 1 (56-62)
    for (let idx = 35; idx < SQUARES; idx++) {
        yellowAdvanceBB = setBit(yellowAdvanceBB, idx);
    }
    console.log("Positional Masks Initialized.");
}

/**
 * Pre-calculates bitmasks for water squares between potential jump start/end points.
 * Stores masks in the `jumpPathMasks` object.
 * MUST be called after initializeBitboardCoordMapping.
 * Depends on: ROWS, COLS (constants.js), getCoords, coordToBitIndex, setBit, WATER_SQUARES.
 */
function initializeJumpMasks() {
    if (Object.keys(jumpPathMasks).length > 0) return; // Already initialized
    console.log("Initializing Jump Path Masks...");

    const addMask = (r1, c1, r2, c2) => {
        const fromCoords = getCoords(r1, c1);
        const toCoords = getCoords(r2, c2);
        const fromIdx = coordToBitIndex(fromCoords);
        const toIdx = coordToBitIndex(toCoords);

        if (fromIdx === -1 || toIdx === -1) {
            console.error(`Invalid coords for jump mask: ${fromCoords} -> ${toCoords}`);
            return;
        }

        let mask = BB_EMPTY;
        // Vertical Jump (col is same, row diff is 4)
        if (c1 === c2 && Math.abs(r1 - r2) === 4) {
            const startRow = Math.min(r1, r2); // Start from the lower row index (higher number)
            for (let rPath = startRow + 1; rPath < startRow + 4; rPath++) {
                const pathCoords = getCoords(rPath, c1);
                if (pathCoords && WATER_SQUARES.has(pathCoords)) {
                    const pIdx = coordToBitIndex(pathCoords);
                    if (pIdx !== -1) mask = setBit(mask, pIdx);
                } else if(pathCoords) {
                    // This path square should be water for a valid jump
                }
            }
        }
        // Horizontal Jump (row is same, col diff is 3)
        else if (r1 === r2 && Math.abs(c1 - c2) === 3) {
            const startCol = Math.min(c1, c2); // Start from lower col index
            for (let cPath = startCol + 1; cPath < startCol + 3; cPath++) {
                const pathCoords = getCoords(r1, cPath);
                if (pathCoords && WATER_SQUARES.has(pathCoords)) {
                    const pIdx = coordToBitIndex(pathCoords);
                    if (pIdx !== -1) mask = setBit(mask, pIdx);
                } else if(pathCoords) {
                    // This path square should be water for a valid jump
                }
            }
        } else {
            // Should not happen if called correctly, but good to catch
            console.error(`Invalid jump geometry for mask: ${fromCoords} -> ${toCoords}`);
            return;
        }

        // Store the mask for both directions if it's not empty
        if (mask !== BB_EMPTY) {
             jumpPathMasks[`${fromIdx}-${toIdx}`] = mask;
             jumpPathMasks[`${toIdx}-${fromIdx}`] = mask;
        } else {
            // If mask is empty, it means the path wasn't over water - not a valid jump path to mask.
        }
    };

    // Iterate through all possible jump starting squares (must be land)
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const fromCoords = getCoords(r, c);
            if (!fromCoords || WATER_SQUARES.has(fromCoords)) continue; // Must start from land

            // Check potential Vertical Jumps across river (Cols 1, 2, 4, 5)
            if (c === 1 || c === 2 || c === 4 || c === 5) {
                // Jump North (check squares R+1, R+2, R+3 are water)
                if (r >= 3) addMask(r, c, r - 4, c); // Lands on r-4
                // Jump South (check squares R-1, R-2, R-3 are water)
                if (r <= 5) addMask(r, c, r + 4, c); // Lands on r+4
            }
            // Check potential Horizontal Jumps across river (Rows 3, 4, 5 -> Indices 5, 4, 3)
            if (r >= 3 && r <= 5) {
                // Jump West (check squares C+1, C+2 are water)
                if (c >= 3) addMask(r, c, r, c - 3); // Lands on c-3
                // Jump East (check squares C-1, C-2 are water)
                if (c <= 3) addMask(r, c, r, c + 3); // Lands on c+3
            }
        }
    }
    console.log(`Jump Path Masks Initialized (${Object.keys(jumpPathMasks).length} entries).`);
}


// --- Jump Path Checking ---

/**
 * Checks if the path for a jump is clear of opponent swimming pieces using bitboards.
 * Requires pre-calculated jumpPathMasks.
 * Depends on: O_RAT_IDX, Y_RAT_IDX, O_DOG_IDX, Y_DOG_IDX, PLAYERS (constants.js), jumpPathMasks, setBit.
 *
 * @param {number} fromIndex - Start square index.
 * @param {number} toIndex - End square index.
 * @param {string} attackerPlayer - The player making the jump (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @returns {boolean} True if the path is clear, false otherwise.
 */
function checkJumpPathClearBB(fromIndex, toIndex, attackerPlayer, bitboards) {
    const opponent = attackerPlayer === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const opponentRatIndex = opponent === PLAYERS.ORANGE ? O_RAT_IDX : Y_RAT_IDX;
    const opponentDogIndex = opponent === PLAYERS.ORANGE ? O_DOG_IDX : Y_DOG_IDX;

    // --- Safety Checks ---
    // Check if bitboards array is valid
    if (!Array.isArray(bitboards) || bitboards.length <= Math.max(opponentRatIndex, opponentDogIndex)) {
        console.error("checkJumpPathClearBB: Invalid bitboards array provided or too short.");
        return false; // Cannot check path
    }
    // Check if piece indices are valid
    if (opponentRatIndex === -1 || opponentDogIndex === -1) {
         console.error("checkJumpPathClearBB: Invalid piece indices for opponent swimmers.");
         return false; // Cannot check path if indices are wrong
    }
    // --- End Safety Checks ---

    // Combine opponent's swimmer bitboards
    const opponentSwimmerBB = bitboards[opponentRatIndex] | bitboards[opponentDogIndex];

    // Lookup the mask for the water squares between from and to
    const pathKey = `${fromIndex}-${toIndex}`;
    const pathMask = jumpPathMasks[pathKey];

    if (typeof pathMask === 'undefined') {
        // This implies the jump geometry wasn't valid or wasn't precalculated.
        // This shouldn't be reached if isValidMoveBB checks geometry first.
        return false; // Treat as blocked if mask missing
    }

    // Check if any opponent swimmer occupies a square in the path mask
    // Path is clear if the intersection of the path mask and opponent swimmers is empty
    return (pathMask & opponentSwimmerBB) === BB_EMPTY;
}

// Add this function to the end of bitboardUtils.js

/**
 * Generates a bitboard representing all squares attacked by the given player's pieces.
 * Considers piece movement rules (orthogonal, swimming, jumps) and terrain.
 * Handles special cases like Rat vs Elephant attacks.
 * Depends on: BB_IDX, ROWS, COLS, SQUARES, PLAYERS, SPECIAL_ABILITIES,
 *             O_ELEPHANT_IDX, Y_ELEPHANT_IDX (constants.js),
 *             lsbIndex, clearBit, getBit, waterBB (global state), checkJumpPathClearBB.
 *
 * @param {bigint[]} bitboards - The current bitboard state array.
 * @param {string} player - The player ('orange' or 'yellow') whose attack map to generate.
 * @returns {bigint} A bitboard mask of all attacked squares. Returns BB_EMPTY on error.
 */
function generateAttackMapsBB(bitboards, player) {
    let attackMapBB = BB_EMPTY;

    // Validate inputs
    if (!Array.isArray(bitboards) || bitboards.length !== BB_IDX.COUNT ||
        (player !== PLAYERS.ORANGE && player !== PLAYERS.YELLOW)) {
        console.error("generateAttackMapsBB: Invalid bitboards or player provided.");
        return BB_EMPTY;
    }

    const pieceTypeStart = player === PLAYERS.ORANGE ? BB_IDX.PIECE_START : Y_RAT_IDX;
    const pieceTypeEnd = player === PLAYERS.ORANGE ? O_ELEPHANT_IDX : BB_IDX.PIECE_END;
    const opponent = player === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    const opponentElephantIndex = opponent === PLAYERS.ORANGE ? O_ELEPHANT_IDX : Y_ELEPHANT_IDX;
    const opponentElephantBB = bitboards[opponentElephantIndex]; // Opponent's elephant location

    for (let pieceTypeIndex = pieceTypeStart; pieceTypeIndex <= pieceTypeEnd; pieceTypeIndex++) {
        let pieceBoard = bitboards[pieceTypeIndex]; // BB for the current piece type

        while (pieceBoard !== BB_EMPTY) {
            const fromIndex = lsbIndex(pieceBoard);
            if (fromIndex === -1 || fromIndex >= SQUARES) {
                console.error(`generateAttackMapsBB: Invalid LSB index ${fromIndex} for type ${pieceTypeIndex}.`);
                break; // Prevent infinite loop
            }

            const rank = (pieceTypeIndex % 8) + 1;
            const abilities = SPECIAL_ABILITIES[rank];
            if (!abilities) {
                console.error(`generateAttackMapsBB: Missing abilities for rank ${rank} (type ${pieceTypeIndex}).`);
                pieceBoard = clearBit(pieceBoard, fromIndex);
                continue;
            }

            const isSwimmer = abilities.swims || false;
            const canJumpV = abilities.jumpV || false;
            const canJumpH = abilities.jumpH || false;
            const isFromLand = getBit(waterBB, fromIndex) === 0n;
            const isFromWater = !isFromLand;
            const pieceBB = 1n << BigInt(fromIndex);
            let pieceAttacks = BB_EMPTY; // Attacks generated by this specific piece

            // --- Orthogonal Attacks ---
            const fromRow = Math.floor(fromIndex / COLS);
            const fromCol = fromIndex % COLS;
            let orthoTargetsBB = BB_EMPTY;
            if (fromRow > 0) orthoTargetsBB |= (pieceBB >> BigInt(COLS)); // North
            if (fromRow < ROWS - 1) orthoTargetsBB |= (pieceBB << BigInt(COLS)); // South
            if (fromCol > 0) orthoTargetsBB |= (pieceBB >> 1n);        // West
            if (fromCol < COLS - 1) orthoTargetsBB |= (pieceBB << 1n);        // East

            // Apply water restrictions for non-swimmers attacking FROM land
            if (!isSwimmer && isFromLand) {
                orthoTargetsBB &= ~waterBB; // Non-swimmers cannot attack *into* water
            }
            // Swimmers can attack adjacent water or land squares.
            // Non-swimmers starting *in* water is illegal state, but if it happened, they can't attack.
            if (!isSwimmer && isFromWater) {
                orthoTargetsBB = BB_EMPTY; // Non-swimmer in water cannot attack
            }
            pieceAttacks |= orthoTargetsBB;

            // --- Jump Attacks (Only from land) ---
            if (isFromLand) {
                let potentialJumpTargetsBB = BB_EMPTY;
                // Vertical Jumps
                if (canJumpV && (fromCol === 1 || fromCol === 2 || fromCol === 4 || fromCol === 5)) {
                    if (fromIndex >= 4 * COLS) potentialJumpTargetsBB |= (pieceBB >> BigInt(4 * COLS));
                    if (fromIndex < SQUARES - (4 * COLS)) potentialJumpTargetsBB |= (pieceBB << BigInt(4 * COLS));
                }
                // Horizontal Jumps
                if (canJumpH && (fromRow >= 3 && fromRow <= 5)) {
                    if (fromCol >= 3) potentialJumpTargetsBB |= (pieceBB >> 3n);
                    if (fromCol <= COLS - 1 - 3) potentialJumpTargetsBB |= (pieceBB << 3n);
                }

                // Filter jump targets: must land on land
                potentialJumpTargetsBB &= ~waterBB;

                // Check jump path clear for each potential jump target
                let tempJumpTargets = potentialJumpTargetsBB;
                while (tempJumpTargets !== BB_EMPTY) {
                    const jumpTargetIdx = lsbIndex(tempJumpTargets);
                     if (jumpTargetIdx !== -1 && jumpTargetIdx < SQUARES) {
                        // Check jump path using the standard function
                        if (checkJumpPathClearBB(fromIndex, jumpTargetIdx, player, bitboards)) {
                            pieceAttacks |= (1n << BigInt(jumpTargetIdx)); // Add valid jump attack target
                        }
                    } else {
                        console.error(`generateAttackMapsBB: Invalid LSB jump target index ${jumpTargetIdx}.`);
                        break;
                    }
                    tempJumpTargets = clearBit(tempJumpTargets, jumpTargetIdx);
                }
            }

            // --- Handle Rat vs Elephant Special Case ---
            if (rank === 1) { // If the attacker is a Rat
                 // Check if any generated attack targets the opponent's Elephant
                 let ratAttackElephantTargets = pieceAttacks & opponentElephantBB;

                 if (ratAttackElephantTargets !== BB_EMPTY) {
                     // Rat cannot attack Elephant IF the Rat starts from water.
                     if (isFromWater) {
                         // Remove the elephant targets from the Rat's attack map
                         pieceAttacks &= ~opponentElephantBB;
                     }
                     // If Rat starts from land, the attack is allowed (already included in pieceAttacks)
                 }
            }

            // Combine this piece's attacks with the total map
            attackMapBB |= pieceAttacks;

            // Clear the processed piece's bit from the temp board
            pieceBoard = clearBit(pieceBoard, fromIndex);
        } // End while (pieceBoard)
    } // End for (pieceTypeIndex)

    return attackMapBB;
}


// --- Export (if using modules) ---
// export { setBit, clearBit, getBit, popcount, lsbIndex, ... };
