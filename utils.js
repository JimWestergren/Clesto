/* START OF FILE utils.js */

/**
 * @fileoverview General utility functions for the Clesto game.
 */

/**
 * Converts zero-based row and column indices to algebraic notation (e.g., 0,0 -> 'a9').
 * Relies on ROWS and COLS constants being available.
 * @param {number} row - The row index (0 to ROWS-1).
 * @param {number} col - The column index (0 to COLS-1).
 * @returns {string|null} The algebraic coordinates (e.g., 'a1', 'g9') or null if invalid.
 */
function getCoords(row, col) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    // Column 'a' is ASCII 97. Row 9 is at index 0.
    return `${String.fromCharCode(97 + col)}${ROWS - row}`;
}

/**
 * Converts algebraic notation coordinates to zero-based row and column indices.
 * Relies on ROWS and COLS constants being available.
 * @param {string} coords - The algebraic coordinates (e.g., 'a1', 'g9').
 * @returns {{row: number, col: number}|null} An object with row and col indices, or null if invalid.
 */
function getRowCol(coords) {
    if (!coords || typeof coords !== 'string' || coords.length < 2) return null;
    const col = coords.charCodeAt(0) - 97; // 'a' -> 0, 'b' -> 1, ...
    const rowNum = parseInt(coords.substring(1));
    if (isNaN(rowNum)) return null;
    const row = ROWS - rowNum; // '9' -> 0, '8' -> 1, ...
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return { row, col };
}

/**
 * Gets orthogonally adjacent coordinates for a given square.
 * @param {string} coords - The algebraic coordinates (e.g., 'd9').
 * @returns {string[]} An array of valid adjacent coordinate strings.
 */
function getAdjacentCoords(coords) {
    const adjacent = [];
    const rc = getRowCol(coords);
    if (!rc) return [];
    const { row, col } = rc;
    const potential = [
        getCoords(row + 1, col), // Down
        getCoords(row - 1, col), // Up
        getCoords(row, col + 1), // Right
        getCoords(row, col - 1)  // Left
    ];
    potential.forEach(c => {
        if (c) adjacent.push(c); // Add if valid coords
    });
    return adjacent;
}

/**
 * Checks if the given coordinates correspond to ANY trap square.
 * Relies on the ALL_TRAP_SQUARES constant Set being available.
 * @param {string} coords - The algebraic coordinates to check.
 * @returns {boolean} True if the coordinates are a trap square, false otherwise.
 */
function isOnTrapSquare(coords) {
    if (!coords) return false;
    // Use the pre-defined Set containing all trap squares
    return ALL_TRAP_SQUARES.has(coords);
}

/**
 * Generates a random 64-bit BigInt.
 * Uses Math.random() which is pseudo-random, sufficient for Zobrist hashing.
 * Ensures the result is non-zero.
 * @returns {bigint} A random BigInt between 1 and 2^64 - 1.
 */
function generateRandomBigInt() {
    let randomBigInt;
    do {
        // Generate two 32-bit random numbers and combine them
        const high = BigInt(Math.floor(Math.random() * (2 ** 32)));
        const low = BigInt(Math.floor(Math.random() * (2 ** 32)));
        // Shift the high part by 32 bits and combine with the low part
        randomBigInt = (high << 32n) | low;
    } while (randomBigInt === 0n); // Ensure the key is not zero
    return randomBigInt;
}

/**
 * Gets the unique index (0-15) for a given piece type (player and rank).
 * Orange ranks 1-8 map to 0-7.
 * Yellow ranks 1-8 map to 8-15.
 * Relies on the PLAYERS constant being available.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {number} rank - The piece rank (1-8).
 * @returns {number} The piece type index (0-15), or -1 if invalid input.
 */
function getPieceTypeIndex(player, rank) {
    if (rank < 1 || rank > 8) return -1;
    if (player === PLAYERS.ORANGE) {
        return rank - 1; // Orange R1=0, R2=1, ..., R8=7
    } else if (player === PLAYERS.YELLOW) {
        return rank - 1 + 8; // Yellow R1=8, R2=9, ..., R8=15
    }
    return -1; // Invalid player
}

/**
 * Formats remaining seconds into MM:SS string format.
 * @param {number} totalSeconds - The total seconds remaining.
 * @returns {string} Formatted time string (e.g., "09:58").
 */
function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds)); // Ensure non-negative integer seconds
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(remainingSeconds).padStart(2, '0');
    return `${formattedMinutes}:${formattedSeconds}`;
}

/**
 * Generates a human-readable description for a move given its notation.
 * Parses notation like "8a3", "7g1x", "1G3S+", "e7-STARVED".
 * Depends on: RANK_TO_NAME (constants.js).
 * @param {string|null} notation - The move notation string (e.g., '7g1x', '1a7S++').
 * @returns {string|null} A descriptive string or null if notation is invalid/null.
 */
function generateMoveDescription(notation) {
    if (!notation || typeof notation !== 'string') {
        return null;
    }

    // Handle special case: Starvation before move completion
    const starvedMatch = notation.match(/^([a-gA-G][1-9])-STARVED$/);
    if (starvedMatch) {
        return `Piece at ${starvedMatch[1]} was starved and removed.`;
    }

    // Regex to parse standard notation: Rank, optional 'x', Destination, optional 'S's, optional '+'s
    // Rank: [1-8]
    // Capture: (x?) - Optional 'x'
    // Destination: ([a-gA-G][1-9])
    // Starvation: (S*) - Zero or more 'S'
    // Hungry: (\+*) - Zero or more '+'
    const match = notation.match(/^([1-8])(x?)([a-gA-G][1-9])(S*)(\+*)$/);

    if (!match) {
        console.warn("generateMoveDescription: Could not parse notation:", notation);
        return `Move: ${notation}`; // Fallback for unparsed notation
    }

    const rank = parseInt(match[1], 10);
    const isCapture = match[2] === 'x';
    const destination = match[3];
    const starvedCount = match[4].length;
    const hungryCount = match[5].length;

    const pieceName = RANK_TO_NAME[rank] || `Rank ${rank}`;
    let description = pieceName;

    if (isCapture) {
        description += ` captures at ${destination}`;
    } else {
        description += ` moves to ${destination}`;
    }

    if (starvedCount > 0) {
        description += `, starving ${starvedCount} piece${starvedCount > 1 ? 's' : ''}`;
    }

    if (hungryCount > 0) {
        description += `, declaring ${hungryCount} opponent piece${hungryCount > 1 ? 's' : ''} hungry`;
    }

    return description + ".";
}

/**
 * Generates the tooltip content string for a piece based on its rank.
 * Uses emojis for rank and special abilities.
 * Depends on: RANK_EMOJI, SPECIAL_ABILITIES (constants.js).
 * @param {number} rank - The rank of the piece (1-8).
 * @returns {string|null} The tooltip content string (e.g., "R: 1️⃣\nSP: 💧🐾🌱") or null if rank is invalid.
 */
function generatePieceInfoTooltipContent(rank) {
    if (rank < 1 || rank > 8) return null;

    const rankEmoji = RANK_EMOJI[rank] || rank.toString(); // Fallback to number if emoji missing
    const abilities = SPECIAL_ABILITIES[rank];
    const abilitiesEmoji = abilities?.emoji || ''; // Get emoji string or empty if none

    let content = `R: ${rankEmoji}`;
    if (abilitiesEmoji) {
        content += `\nSP: ${abilitiesEmoji}`; // Use newline for separation
    }
    return content;
}


// --- Export (if using modules) ---
// If using ES Modules, you would add:
// export { getCoords, getRowCol, getAdjacentCoords, ... };
// If using CommonJS (Node.js), you would add:
// module.exports = { getCoords, getRowCol, ... };
// For a simple browser script, these are just global functions.